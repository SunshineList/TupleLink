#!/bin/sh
# SPDX-License-Identifier: MIT
#
# 探测「当前出口 IP」，回答一个面板上始终看不到的问题：
# 这台路由器现在到底从哪出去？
#
# 两次探测走不同路径：
#   direct  显式绕过代理（--noproxy '*'），拿到这条宽带直接出去的地址
#   proxied 跟随系统路由与 DNS，也就是用户日常上网时的真实路径
#
# 结论只用于判断「这两个 IP 是否相同」：
#   不同 → 分流确实生效，流量被送去了别处
#   相同 → 没走代理，或者代理和直连恰好同一出口
# 不做 GeoIP 归属地：路由器上不一定有地理库，而「变没变」已经足够说明问题。
#
# 全程只读，不改 UCI、不改防火墙、不动服务状态。

set +x

# 单个探测最多等 4 秒；三个候选接口轮一遍也就在十秒内结束，
# 不会把 rpcd worker 拖住。
BOUND=4

# 只保留 IP 字面量可能出现的字符，避免把引号或控制字符带进 JSON。
# IP 最长 45 字符（IPv6 带 IPv4 映射时）。
sanitize_ip() {
	printf '%s' "$1" | tr -d '"\\\000-\037' | cut -c1-45
}

# 依次尝试几个只回显 IP 的纯文本接口，第一个成功即返回。
fetch_ip() {
	_proxy_off=$1
	for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com"; do
		if [ "$_proxy_off" = yes ]; then
			out=$(curl -fsS --noproxy '*' --connect-timeout "$BOUND" --max-time "$BOUND" "$url" 2>/dev/null)
		else
			out=$(curl -fsS --connect-timeout "$BOUND" --max-time "$BOUND" "$url" 2>/dev/null)
		fi
		# 必须是 IPv4/IPv6 形状：把错误页当成 IP 显示会误导用户。
		case "$out" in
			'' | *[!0-9a-fA-F:.]*) continue ;;
		esac
		[ ${#out} -le 45 ] || continue
		# 至少得有一个数字，排除 "http" 这种纯字母。
		case "$out" in
			*[0-9]*) printf '%s' "$out"; return 0 ;;
		esac
	done
	return 1
}

direct=$(fetch_ip yes || echo '')
proxied=$(fetch_ip no || echo '')
direct=$(sanitize_ip "$direct")
proxied=$(sanitize_ip "$proxied")

json_init
json_add_string direct "$direct"
json_add_string proxied "$proxied"
if [ -n "$direct" ] && [ -n "$proxied" ]; then
	if [ "$direct" = "$proxied" ]; then
		json_add_string verdict same
	else
		json_add_string verdict different
	fi
else
	# 缺一条就报 unknown：不能因为某个探测接口挂了就断言分流失效。
	json_add_string verdict unknown
fi
json_dump
