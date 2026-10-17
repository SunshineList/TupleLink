#!/bin/sh
# SPDX-License-Identifier: MIT
# Native packages only. Never changes firmware, firewall or other proxy services.
set -eu
umask 077

REPOSITORY=slobys/daed
release=openwrt-v0.1.0
asset_dir=''
mode=install
stage=''
backup=''
stopped=0

fail() { printf 'Daed: %s\n' "$*" >&2; exit 1; }
usage() {
	cat <<'EOF'
Usage: sh install.sh [--release TAG] [--asset-dir DIRECTORY] [--check | --dry-run]
  --check       Read-only compatibility check; no package/repository changes.
  --dry-run     Also select and verify packages; do not install or start anything.
  --asset-dir   Use downloaded release assets (dependencies still use firmware feeds).
EOF
}
cleanup() {
	result=$?
	trap - EXIT HUP INT TERM
	[ -z "$stage" ] || rm -rf "$stage"
	if [ "$result" -ne 0 ] && [ "$stopped" = 1 ]; then
		# Package maintainer scripts may have restarted the managed service.
		/etc/init.d/daed stop >/dev/null 2>&1 || :
		printf 'Daed: Installation did not complete. Service remains stopped. Configuration backup: %s\n' "${backup:-not created}" >&2
	fi
	exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

while [ "$#" -gt 0 ]; do
	case "$1" in
	--release) [ "$#" -ge 2 ] || fail 'Missing release tag.'; release=$2; shift 2 ;;
	--asset-dir) [ "$#" -ge 2 ] || fail 'Missing asset directory.'; asset_dir=$2; shift 2 ;;
	--check) mode=check; shift ;;
	--dry-run) mode=dry-run; shift ;;
	--help|-h) usage; exit 0 ;;
	*) usage; fail "Unknown option: $1" ;;
	esac
done
case "$release" in ''|*[!a-zA-Z0-9._-]*) fail 'Invalid release tag.' ;; esac
[ "$(id -u)" = 0 ] || fail 'Run on the router as root.'
if [ ! -r /etc/openwrt_release ] || ! command -v uci >/dev/null 2>&1; then
	fail 'Requires OpenWrt / ImmortalWrt / iStoreOS.'
fi
[ -r /www/luci-static/resources/luci.js ] || fail 'Install the firmware-provided LuCI first.'
machine=$(uname -m)
case "$machine" in x86_64|aarch64) ;; *) fail "Unsupported CPU: $machine" ;; esac
for tool in jsonfilter sha256sum awk mktemp; do
	command -v "$tool" >/dev/null 2>&1 || fail "Missing tool: $tool"
done
[ -r /usr/share/libubox/jshn.sh ] || fail 'Install the firmware-provided jshn package first.'

if command -v apk >/dev/null 2>&1; then
	format=apk
	apk_version=$(apk --version) || fail 'Cannot read apk-tools version.'
	printf '%s\n' "$apk_version" | grep -Eq '^apk-tools v?3\.' || fail 'These APK packages require apk-tools 3.x. Use compatible firmware; no package manager or firmware is replaced.'
	architectures=$(apk --print-arch) || fail 'Cannot read apk architecture.'
elif command -v opkg >/dev/null 2>&1; then
	format=ipk
	architectures=$(opkg print-architecture | awk '$1=="arch" && $2!="all" && $2!="noarch" {print $3, $2}' | sort -rn | awk '{print $2}')
else
	fail 'Neither opkg nor apk is available.'
fi
stage=$(mktemp -d /tmp/daed-install.XXXXXX) || fail 'Cannot create staging directory.'
if [ -n "$asset_dir" ]; then
	[ -d "$asset_dir" ] || fail 'Asset directory does not exist.'
	asset_dir=$(cd "$asset_dir" && pwd -P)
fi

fetch() {
	name=$1
	case "$name" in ''|.*|*[!a-zA-Z0-9._-]*) fail 'Invalid asset filename.' ;; esac
	if [ -n "$asset_dir" ]; then
		cp "$asset_dir/$name" "$stage/$name" || fail "Missing local asset: $name"
	elif command -v curl >/dev/null 2>&1; then
		curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 180 \
			--output "$stage/$name" "https://github.com/$REPOSITORY/releases/download/$release/$name" || \
			fail "Cannot download $name. This tag must contain the OpenWrt release assets."
	elif command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 180 -O "$stage/$name" "https://github.com/$REPOSITORY/releases/download/$release/$name" || fail "Cannot download $name. Check release assets, network and CA certificates."
	else
		fail 'Requires curl or uclient-fetch with working HTTPS certificate verification.'
	fi
}

# A source checkout can run --check before the first release is published.
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
if [ "$mode" = check ] && [ -r "$source_dir/files/daed-check" ]; then
	sh "$source_dir/files/daed-check" --check
	exit $?
fi
fetch manifest.tsv
[ "$(head -n 1 "$stage/manifest.tsv")" = '# daed-openwrt-manifest-v1' ] || fail 'Unknown manifest format.'
awk -F '\t' '!/^#/ && NF && (NF!=6 || $1!~/^(ipk|apk|support)$/ || $3!~/^(daed-router|luci-app-daed-router|check)$/) {bad=1} END {exit bad}' "$stage/manifest.tsv" || fail 'Malformed manifest.'

record() {
	awk -F '\t' -v fmt="$1" -v arch="$2" -v pkg="$3" '$1==fmt && $2==arch && $3==pkg {line=$0; count++} END {if(count!=1) exit 1; print line}' "$stage/manifest.tsv"
}
verify_record() {
	row=$1
	file=$(printf '%s\n' "$row" | cut -f4)
	hash=$(printf '%s\n' "$row" | cut -f5)
	if [ "${#hash}" != 64 ] || ! printf '%s\n' "$hash" | grep -Eq '^[a-f0-9]+$'; then fail 'Invalid checksum.'; fi
	fetch "$file"
	printf '%s  %s\n' "$hash" "$stage/$file" | sha256sum -c - >/dev/null || fail "Checksum mismatch: $file"
}
support=$(record support all check) || fail 'Manifest has no unique compatibility checker.'
[ "$(printf '%s\n' "$support" | cut -f4)" = daed-check ] || fail 'Unexpected checker filename.'
verify_record "$support"
sh "$stage/daed-check" --check || fail 'Compatibility check failed. No packages or network settings were changed.'
[ "$mode" != check ] || exit 0

runtime=''
selected_arch=''
for architecture in $architectures; do
	case "$machine:$architecture" in x86_64:x86_64|aarch64:aarch64|aarch64:aarch64_*) ;; *) continue ;; esac
	if runtime=$(record "$format" "$architecture" daed-router); then selected_arch=$architecture; break; fi
done
[ -n "$selected_arch" ] || fail "No $format runtime for the firmware's package architectures: $architectures"
plugin=$(record "$format" all luci-app-daed-router) || fail 'Manifest has no unique LuCI package.'
version=$(printf '%s\n' "$runtime" | cut -f6)
if [ "$version" != "$(printf '%s\n' "$plugin" | cut -f6)" ] || \
	[ "$version" != "$(printf '%s\n' "$support" | cut -f6)" ]; then fail 'Runtime, LuCI and checker versions do not match.'; fi
verify_record "$runtime"
runtime_file=$(printf '%s\n' "$runtime" | cut -f4)
verify_record "$plugin"
plugin_file=$(printf '%s\n' "$plugin" | cut -f4)
case "$runtime_file:$plugin_file" in *.$format:*.$format) ;; *) fail 'Package extensions do not match the package manager.' ;; esac

installed() {
	if [ "$format" = apk ]; then apk info --exists "$1" >/dev/null 2>&1
	else opkg status "$1" 2>/dev/null | grep -q '^Status:.* installed'; fi
}
managed=0
if installed daed-router; then
	[ -r /usr/share/daed-router/version ] || fail 'Managed runtime marker is missing; repair the existing installation first.'
	managed=1
elif [ -e /usr/bin/daed ] || [ -e /etc/config/daed ] || [ -e /etc/init.d/daed ] || [ -d /etc/daed ]; then
	fail 'An existing unmanaged Daed installation was found. Back it up and migrate explicitly; it will not be overwritten.'
fi
if installed daed || installed luci-app-daed; then fail 'Another Daed package is installed; explicit migration is required.'; fi
printf 'Daed: %s / %s / %s, release %s\n' "$machine" "$format" "$selected_arch" "$version"
[ "$mode" != dry-run ] || { printf 'Daed: Dry run passed; no packages, configuration or services changed.\n'; exit 0; }

# Native package managers resolve kmods against the router's own feeds/kernel ABI.
# Never force dependencies or add a feed for a different firmware.
if [ "$format" = apk ]; then apk update; else opkg update; fi
was_running=0
was_autostart=0
if [ "$managed" = 1 ]; then
	/etc/init.d/daed enabled >/dev/null 2>&1 && was_autostart=1
	if pidof daed >/dev/null 2>&1; then was_running=1; fi
	/etc/init.d/daed stop || fail 'Cannot stop existing service for a consistent backup.'
	stopped=1
	waited=0
	while pidof daed >/dev/null 2>&1; do
		[ "$waited" -lt 35 ] || fail 'Daed is still running; database backup was not attempted.'
		sleep 1; waited=$((waited + 1))
	done
	mkdir -p /root/daed-backups
	chmod 700 /root/daed-backups
	backup="/root/daed-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
	set -- etc/config/daed usr/share/daed-router/version
	[ ! -d /etc/daed ] || set -- "$@" etc/daed
	tar -czf "$backup" -C / "$@" || fail 'Cannot back up existing data.'
	chmod 600 "$backup"
fi
if [ "$format" = apk ]; then
	# Local release packages are unsigned; this flag is scoped to this transaction.
	apk add --allow-untrusted "$stage/$runtime_file" "$stage/$plugin_file"
else
	opkg install "$stage/$runtime_file" "$stage/$plugin_file"
fi
if ! installed daed-router || ! installed luci-app-daed-router; then fail 'Native packages were not both installed.'; fi
if [ ! -x /usr/bin/daed ] || [ ! -x /usr/libexec/daed/check ]; then fail 'Installed runtime is incomplete.'; fi
if [ "$managed" = 0 ]; then
	uci set daed.main.enabled=1
	uci commit daed
	/etc/init.d/daed enable
	was_running=1
elif [ "$was_autostart" = 1 ]; then
	/etc/init.d/daed enable
else
	/etc/init.d/daed disable
fi
/etc/init.d/rpcd reload
if [ "$was_running" = 1 ]; then
	/etc/init.d/daed start
	listen=$(/usr/libexec/daed/check --listen) || fail 'Installed listen address is invalid.'
	waited=0
	until /usr/libexec/daed/check | jsonfilter -e '@.running' | grep -q '^true$' && \
		uclient-fetch -T 2 -O /dev/null "http://$listen/" >/dev/null 2>&1; do
		[ "$waited" -lt 20 ] || { /etc/init.d/daed stop; fail 'Management HTTP did not become ready. Check Services > Daed > Logs.'; }
		sleep 1; waited=$((waited + 1))
	done
fi
stopped=0
printf 'Daed: Installed. Refresh LuCI and open Services > Daed. Management readiness does not prove LAN proxy traffic.\n'
[ -z "$backup" ] || printf 'Daed: Configuration backup (contains secrets): %s\n' "$backup"
