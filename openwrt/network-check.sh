#!/bin/sh
# SPDX-License-Identifier: MIT
# Inspect the current datapath and make bounded public connectivity requests.
# Never change UCI, services, routing, firewall, qdiscs or the Daed database.
set +x

for tool in ubus jsonfilter; do
	command -v "$tool" >/dev/null 2>&1 || { echo "Missing command: $tool"; exit 1; }
done
printf 'Daed network check v1 (configuration read-only)\n'
printf 'time='; date -Iseconds
printf 'kernel='; uname -r
printf 'package='; cat /usr/share/daed-router/version 2>/dev/null || echo unknown

lan=$(uci -q get daed.main.lan_network 2>/dev/null) || lan=lan
case "$lan" in ''|*[!a-zA-Z0-9_]*) lan=lan ;; esac
devices=''
printf '\n[Logical interfaces and actual devices]\n'
for network in "$lan" wan wan6; do
	state=$(ubus call "network.interface.$network" status 2>/dev/null) || state='{}'
	device=$(printf '%s' "$state" | jsonfilter -e '@.l3_device' 2>/dev/null)
	up=$(printf '%s' "$state" | jsonfilter -e '@.up' 2>/dev/null)
	printf 'network=%s up=%s device=%s\n' "$network" "${up:-unknown}" "${device:-unknown}"
	case "$device" in ''|*[!a-zA-Z0-9_.:@-]*) ;; *) devices="$devices $device" ;; esac
done
if command -v ip >/dev/null 2>&1; then
	printf '\n[Default routes]\n'
	ip -4 route show default 2>/dev/null | head -n 8
	ip -6 route show default 2>/dev/null | head -n 8
fi

printf '\n[Managed services]\n'
services=$(ubus call service list 2>/dev/null) || services='{}'
for service in daed dae passwall passwall2 openclash mihomo sing-box; do
	active=$(printf '%s' "$services" | jsonfilter -e "@[\"$service\"].instances.*.running" 2>/dev/null)
	case "$active" in *true*) running=yes ;; *) running=no ;; esac
	printf '%s running=%s\n' "$service" "$running"
done

printf '\n[Existing traffic-control filters; no attachment changes]\n'
if command -v tc >/dev/null 2>&1; then
	for device in $devices; do
		printf 'device=%s ingress\n' "$device"
		tc filter show dev "$device" ingress 2>/dev/null | head -n 12
		printf 'device=%s egress\n' "$device"
		tc filter show dev "$device" egress 2>/dev/null | head -n 12
	done
else
	echo 'tc unavailable; filter inspection skipped'
fi

printf '\n[Google DNS through the local resolver; 6 seconds maximum]\n'
if command -v nslookup >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
	timeout 6 nslookup www.google.com 127.0.0.1 2>&1 | head -n 24
else
	echo 'nslookup/timeout unavailable; DNS probe skipped'
fi

printf '\n[Router HTTPS; transparent routing remains in effect]\n'
if command -v curl >/dev/null 2>&1; then
	for target in cn4 google4 google6; do
		case "$target" in cn4) family=-4; url=https://www.baidu.com/ ;; google4) family=-4; url=https://www.google.com/ ;; google6) family=-6; url=https://www.google.com/ ;; esac
		printf '%s ' "$target"
		curl "$family" --silent --show-error --head --noproxy '*' \
			--connect-timeout 4 --max-time 8 --output /dev/null \
			--write-out 'http=%{http_code} peer=%{remote_ip} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect}\n' \
			"$url" 2>&1
		printf 'curl_exit=%s\n' "$?"
	done
else
	echo 'curl unavailable; HTTPS probes skipped (nothing installed)'
fi

printf '\n[Recent diagnostic logs; credentials redacted]\n'
logs=$(ubus call daed-router logs 2>/dev/null | jsonfilter -e '@.logs' 2>/dev/null)
if [ -n "$logs" ]; then
	printf '%s\n' "$logs" | sed -E \
		-e 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"<>]+#[URL REDACTED]#g' \
		-e 's/([Tt]oken|[Pp]assword|[Aa]uthorization)([=: ]+)[^, ]+/\1\2[REDACTED]/g' \
		-e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[UUID REDACTED]/g' \
		| grep -Ei 'reload|bind to (lan|wan)|dial|dns|timeout|ready|level=(error|warning)' | tail -n 70
else
	echo 'Logs unavailable through the installed RPC; no raw configuration was read'
fi
printf '\nFinished. No configuration, service, routing or firewall changes were made.\n'
