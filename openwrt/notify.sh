#!/bin/sh
# SPDX-License-Identifier: MIT
#
# 把重要事件推送到 Telegram。
#
# 为什么用 GET 而不是 POST：
# 固件不一定装 curl（curl 支持 --data），但 uclient-fetch 是 daed-router 的
# 必需依赖，一定有。而 uclient-fetch 的 POST 支持在各版本间不一致，
# Telegram Bot API 又允许把参数放在查询串里，所以统一走 GET。
#
# 为什么用 HTML 而不是 MarkdownV2：
# MarkdownV2 要求转义十几种字符，节点名里的 - . _ ( ) 全在名单里，
# 漏一个整条消息就发不出去。HTML 模式只需要转义 & < > 三个，
# 出错面小得多，而且同样能加粗、能等宽。
#
# 用法：
#   notify.sh <event> [detail]
#   notify.sh test
#
# 消息排版由本脚本负责，调用方只给「事件名」和一句「详情」，
# 这样所有推送看起来是一致的，改版式只改一处。

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

# test 是用户主动触发的配置验证，不受 enabled 开关限制。
# 用户在打开推送之前要先确认 token/chat 是否正确，此时被「未启用」挡住
# 会让人以为配置坏了。
event_arg=${1:-''}
enabled=$(cfg enabled)
if [ "$event_arg" != "test" ] && [ "$enabled" != "1" ]; then
	emit disabled
fi

token=$(cfg token)
chat=$(cfg chat)
[ -n "$token" ] || emit not_configured
[ -n "$chat" ] || emit not_configured

event=$event_arg
[ -n "$event" ] || emit bad_args
detail=${2:-''}

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

# 事件 -> 图标 + 标题 + 结尾建议。
# 建议行只在失败类事件上出现：成功时多一句话是噪音。
case "$event" in
	test)             icon='🔔'; title='测试消息';        hint='收到这条说明推送配置正确。' ;;
	update_success)   icon='✅'; title='更新完成';        hint='' ;;
	update_error)     icon='❌'; title='更新失败';        hint='节点与配置已保留，详见运行日志。' ;;
	geodata_success)  icon='✅'; title='规则库已更新';    hint='' ;;
	geodata_error)    icon='❌'; title='规则库更新失败';  hint='分流数据可能仍是旧版本。' ;;
	service_down)     icon='⚠️'; title='代理服务异常';    hint='请检查面板状态与运行日志。' ;;
	service_up)       icon='✅'; title='代理服务已恢复';  hint='' ;;
	sub_failed)       icon='⚠️'; title='订阅更新失败';    hint='机场可能换了域名，检查订阅链接。' ;;
	no_nodes)         icon='🚨'; title='节点全部不可用';  hint='当前没有可用出口，检查线路或订阅。' ;;
	*)                icon='ℹ️'; title="$event";          hint='' ;;
esac

host=$(uci -q get daemon.@system[0].hostname 2>/dev/null) || host=''
[ -n "$host" ] || host=$(uci -q get system.@system[0].hostname 2>/dev/null) || host=''
[ -n "$host" ] || host='router'
when=$(date '+%m-%d %H:%M')

# HTML 转义：只有这三个字符会被 Telegram 的 HTML 解析器处理。
# 顺序要紧：& 必须最先替换，否则后面替换出来的 &lt; 会被二次转义。
escape() {
	printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

host_esc=$(escape "$host")
when_esc=$(escape "$when")
detail_esc=$(escape "$detail")
hint_esc=$(escape "$hint")
title_esc=$(escape "$title")

# 排版：图标+加粗标题，空行，等宽块放「主机/时间/详情」，最后是可选的建议。
# 等宽块用 <code> 而不是 <pre>：<pre> 在小屏上会横向滚动。
text="$icon <b>$title_esc</b>"
text="$text
<code>主机  $host_esc
时间  $when_esc"
if [ -n "$detail_esc" ]; then
	text="$text
详情  $detail_esc"
fi
text="$text</code>"
if [ -n "$hint_esc" ]; then
	text="$text

<i>$hint_esc</i>"
fi

# URL 编码：逐字节百分号编码全部字符。
#
# 消息里有中文（UTF-8 多字节），这些字节必须编码，否则 uclient-fetch
# 会发出非法请求。逐个判断哪些字符要编码在 busybox 下依赖 printf 的
# 八进制转义，各版本行为不一致；全量编码最简单可靠，Telegram 完全接受。
urlencode() {
	printf '%s' "$1" | od -An -v -tu1 | tr -s ' \n' ' ' | tr ' ' '\n' | while read -r byte; do
		[ -n "$byte" ] || continue
		printf '%%%02X' "$byte"
	done
}

encoded=$(urlencode "$text")
url="https://api.telegram.org/bot$token/sendMessage?chat_id=$chat&parse_mode=HTML&disable_web_page_preview=true&text=$encoded"

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
