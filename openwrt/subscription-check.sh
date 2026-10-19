#!/bin/sh
# Read-only download diagnostics. Never print subscription URLs, bodies or cookies.
set +x
umask 077

for tool in uci curl jsonfilter sha256sum; do
	command -v "$tool" >/dev/null 2>&1 || { echo "Missing command: $tool"; exit 1; }
done

section=${1:-}
case "$section" in *[!a-zA-Z0-9_]* ) echo 'Use a named PassWall subscription section ID, or omit it.'; exit 1 ;; esac
if [ -n "$section" ]; then
	[ "$(uci -q get "passwall.$section")" = subscribe_list ] || { echo 'Subscription section not found.'; exit 1; }
	sections=$section
else
	sections=$(uci -q show passwall | sed -n 's/^passwall\.\([a-zA-Z0-9_]*\)=subscribe_list$/\1/p' | head -n 3)
fi
[ -n "$sections" ] || { echo 'No named PassWall subscriptions found.'; exit 1; }

work=$(mktemp -d /tmp/daed-subcheck.XXXXXX) || exit 1
cleanup() {
	rm -f "$work/body" "$work/decoded" "$work/cookies" "$work/cookies.new" "$work/curl-error"
	rmdir "$work" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

pw_version=
socks=
if command -v lua >/dev/null 2>&1; then
	pw_version=$(lua -e 'local ok,a=pcall(require,"luci.passwall.api"); if ok and type(a.get_version)=="function" then local v=a.get_version(); if type(v)=="string" then io.write(v:match("^([^-]+)") or "") end end' 2>/dev/null)
	socks=$(lua -e 'local ok,a=pcall(require,"luci.passwall.api"); if ok and type(a.get_cache_var)=="function" then local v=a.get_cache_var("GLOBAL_SOCKS_server"); if type(v)=="string" then io.write(v) end end' 2>/dev/null)
fi
pw_version=$(printf '%s' "$pw_version" | tr -cd 'a-zA-Z0-9._' | cut -c1-48)
case "$socks" in
	127.0.0.1:*|localhost:*|'[::1]:'*) ;;
	0.0.0.0:*) socks="127.0.0.1:${socks##*:}" ;;
	*) socks= ;;
esac
if [ -n "$socks" ]; then
	port=${socks##*:}
	case "$port" in ''|*[!0-9]*) socks= ;; esac
	if [ -n "$socks" ] && { [ "${#port}" -gt 5 ] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; }; then socks=; fi
fi
version=0.3.0
if [ -r /usr/share/daed-router/version ]; then
	IFS= read -r version < /usr/share/daed-router/version
	version=${version%-*}
fi
version=$(printf '%s' "$version" | tr -cd 'a-zA-Z0-9._' | cut -c1-48)

describe_body() {
	code=$(jsonfilter -i "$work/body" -e '@.code' 2>/dev/null)
	if [ "$code" = AUTH_FAIL ]; then printf ' result=AUTH_FAIL'; return; fi
	if [ "$rc" != 0 ]; then printf ' result=TRANSFER_ERROR'; return; fi
	if [ "$http" != 200 ]; then printf ' result=HTTP_ERROR'; return; fi
	if [ "$(jsonfilter -i "$work/body" -e '@.version' 2>/dev/null)" = 1 ]; then
		count=$(jsonfilter -i "$work/body" -e '@.servers[*].server' 2>/dev/null | wc -l | tr -d ' ')
		if [ "$count" -gt 0 ]; then printf ' format=sip008 entries=%s' "$count"; return; fi
	fi
	input=$work/body
	format=plain
	if decode_body > "$work/decoded" 2>/dev/null; then input=$work/decoded; format=base64; fi
	count=$(grep -cE '^[[:space:]]*(vless|vmess|ss|ssr|trojan|hysteria2|hy2|tuic|socks|socks5|http|https|anytls|juicity)://' "$input" || :)
	if [ "$count" -gt 0 ]; then
		printf ' format=%s node_links=%s' "$format" "$count"
	elif grep -qE '^[[:space:]]*proxies:' "$input"; then
		printf ' format=clash_yaml'
	elif grep -qiE '<(!doctype[[:space:]]+html|html)' "$input"; then
		printf ' format=html'
	else
		printf ' format=unknown'
	fi
}

decode_body() {
	if command -v ucode >/dev/null 2>&1; then
		ucode -e 'let fs=require("fs"); let raw=replace(fs.readfile(ARGV[0]), /\s+/g, ""); raw=replace(replace(raw, /-/g, "+"), /_/g, "/"); while(length(raw)%4) raw+="="; let value=b64dec(raw); if(type(value)!="string") exit(1); print(value);' "$work/body"
		return
	fi
	if command -v base64 >/dev/null 2>&1; then base64 -d < "$work/body"; return; fi
	return 1
}

probe() {
	profile=$1
	probe_agent=$2
	: > "$work/body"
	: > "$work/cookies"
	set -- --silent --location --connect-timeout 4 --max-time 12 --max-filesize 4194304 \
		--proto '=http,https' --proto-redir '=http,https' \
		--user-agent "$probe_agent" --output "$work/body" --write-out '%{http_code}'
	if [ "$profile" != system_daed ]; then
		set -- "$@" --header 'Accept: */*' --header 'Accept-Encoding: identity' \
			--cookie "$work/cookies" --cookie-jar "$work/cookies"
	fi
	if [ "$profile" = passwall_socks ]; then
		set -- "$@" --proxy "socks5h://$socks" --noproxy ''
	else
		set -- "$@" --noproxy '*'
	fi
	http=$(curl "$@" --url "$link" 2> "$work/curl-error")
	rc=$?
	case "$http" in [0-9][0-9][0-9]) ;; *) http=000 ;; esac
	printf '  profile=%s http=%s curl_exit=%s' "$profile" "$http" "$rc"
	describe_body
	printf '\n'
}

echo 'NaiLink subscription check v1 (read-only, up to 3 subscriptions)'
echo 'system_* uses curl and may still be affected by transparent proxy rules; it is not the NaiLink route transport.'
localhost_proxy=$(uci -q get 'passwall.@global[0].localhost_proxy')
printf 'localhost_proxy=%s socks_available=%s\n' "${localhost_proxy:-unset}" "$(if [ -n "$socks" ]; then echo yes; else echo no; fi)"
for section in $sections; do
	link=$(uci -q get "passwall.$section.url")
	case "$link" in http://*|https://*) ;; *) printf 'section=%s skipped=missing_http_url\n' "$section"; continue ;; esac
	# A UCI URL must be one line; no eval or shell-built download commands.
	if printf '%s' "$link" | LC_ALL=C grep -q '[[:cntrl:]]'; then
		printf 'section=%s skipped=invalid_url\n' "$section"; continue
	fi
	ua=$(uci -q get "passwall.$section.user_agent")
	case "$ua" in ''|passwall) ua="passwall${pw_version:+/$pw_version}" ;; esac
	if [ "${#ua}" -gt 512 ] || printf '%s' "$ua" | LC_ALL=C grep -q '[[:cntrl:]]'; then
		printf 'section=%s skipped=invalid_user_agent\n' "$section"; continue
	fi
	digest=$(printf '%s' "$link" | sha256sum)
	printf 'section=%s url_sha256=%s\n' "$section" "${digest%% *}"
	probe system_daed "daed/$version (like v2rayA/1.0 WebRequestHelper) (like v2rayN/1.0 WebRequestHelper)"
	probe system_passwall "$ua"
	if [ -n "$socks" ]; then probe passwall_socks "$ua"; fi
done
echo 'Only download diagnostics were performed. No subscription, service, routing or firewall configuration was changed.'
