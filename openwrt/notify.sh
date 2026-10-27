#!/bin/sh
# SPDX-License-Identifier: MIT
#
# 把重要事件推送到 Telegram。
#
# 为什么用 GET 而不是 POST：
# 固件不一定装 curl（curl 支持 --data），但 uclient-fetch 是 daed-router 的
# 必需依赖，一定有。而 uclient-fetch 的 POST 支持在各版本间不一致，
# Telegram Bot API 又允许把参数放在查询串里，所以统一走 GET，
# 一条命令覆盖所有固件。消息正文很短，URL 长度不是问题。
#
# 用法：
#   notify.sh <event> [message]
#   notify.sh test
#
# 设计约束，每条都有理由：
#   - 推送失败绝不返回非零：调用方是后台任务，通知挂了不能影响主流程
#   - token 绝不进日志或回显：只出现在 URL 里，失败时只报固定分类
#   - 同一事件限流：服务反复重启会刷屏，用户会直接关掉通知
#   - 不推节点链接/密码：只推「什么事件、什么时候、简短原因」
#
# 结果分类写到 stdout，调用方可据此判断，但不必依赖。

set +x

CONF=daed
STATE_DIR=/tmp/daed-notify
RATE_SECONDS=300

emit() {
	printf '%s\n' "$1"
	exit 0
}

cfg() {
	# 配置在 config notify 段，与 main 分开：token 属于通知设置，
	# 和代理参数混在一起容易在导出/对比配置时被顺手带出去。
	uci -q get "$CONF.notify.$1" 2>/dev/null
}

enabled=$(cfg enabled)
[ "$enabled" = "1" ] || emit disabled

token=$(cfg token)
chat=$(cfg chat)
[ -n "$token" ] || emit not_configured
[ -n "$chat" ] || emit not_configured

event=${1:-''}
[ -n "$event" ] || emit bad_args

# test 是用户手动触发的，必须每次都发，否则「测试」按钮看起来像坏了。
if [ "$event" != "test" ]; then
	mkdir -p "$STATE_DIR" 2>/dev/null
	stamp="$STATE_DIR/$event"
	if [ -f "$stamp" ]; then
		last=$(cat "$stamp" 2>/dev/null) || last=0
		case "$last" in
			'' | *[!0-9]*) last=0 ;;
		esac
		now=$(date +%s)
		if [ $((now - last)) -lt "$RATE_SECONDS" ]; then
			emit rate_limited
		fi
	fi
	printf '%s' "$(date +%s)" >"$stamp" 2>/dev/null
fi

body=${2:-''}
host=$(uci -q get system.@system[0].hostname 2>/dev/null) || host=''
[ -n "$host" ] || host='router'
when=$(date '+%Y-%m-%d %H:%M:%S')

# 不用 MarkdownV2：它对大量字符要求转义，节点名里的 - 和 . 都会撞上，
# 一旦漏转义整条消息发不出去。纯文本最稳。
text=$(printf '%s\n%s' "$body" "$when")

# URL 编码：逐字节百分号编码全部字符。
#
# 为什么全量编码而不是只编特殊字符：消息里有中文（UTF-8 多字节），
# 这些字节必须编码，否则 uclient-fetch 会发出非法请求。逐个判断哪些
# 要编码在 busybox 下依赖 printf 的八进制转义，各版本行为不一致；
# 全量编码反而最简单可靠，Telegram 也完全接受。
urlencode() {
	printf '%s' "$1" | od -An -v -tu1 | tr -s ' \n' ' ' | tr ' ' '\n' | while read -r byte; do
		[ -n "$byte" ] || continue
		printf '%%%02X' "$byte"
	done
}

encoded=$(urlencode "$text")
url="https://api.telegram.org/bot$token/sendMessage?chat_id=$chat&text=$encoded"

# 发送。8 秒超时：通知不该拖着调用方。
# 输出一律丢弃：uclient-fetch 失败时可能把 URL 打进 stderr，里面有 token。
if command -v uclient-fetch >/dev/null 2>&1; then
	uclient-fetch -q -T 8 -O /dev/null "$url" >/dev/null 2>&1
	status=$?
elif command -v curl >/dev/null 2>&1; then
	curl -fsS --max-time 8 -o /dev/null "$url" >/dev/null 2>&1
	status=$?
else
	emit no_client
fi

[ "$status" = 0 ] && emit sent
emit send_failed
