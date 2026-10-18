#!/bin/sh
# SPDX-License-Identifier: MIT
# Native packages only. Never changes firmware, firewall or other proxy services.
set -eu
umask 077

REPOSITORY=slobys/daed
release=openwrt-v0.5.1
asset_dir=''
mode=install
action=install
stage=''
backup=''
stopped=0

fail() { printf 'Daed: %s\n' "$*" >&2; exit 1; }
usage() {
	cat <<'EOF'
Usage: sh install.sh [--install | --uninstall | --reinstall] [--release TAG] [--asset-dir DIRECTORY] [--check | --dry-run]
  --install     Install or upgrade this project's packages (default).
  --uninstall   Back up data, remove Daed packages and clear its config/data.
  --reinstall   Verify new assets, then back up/uninstall and install fresh.
  --check       Read-only compatibility check; no package/repository changes.
  --dry-run     Verify assets; APK also simulates dependencies using cached feeds.
  --asset-dir   Use downloaded release assets (dependencies still use firmware feeds).
EOF
}
cleanup() {
	result=$?
	trap - EXIT HUP INT TERM
	[ -z "$stage" ] || rm -rf "$stage"
	if [ "$result" -ne 0 ] && [ "$stopped" = 1 ]; then
		# Package maintainer scripts may have restarted the managed service.
		if [ -x /etc/init.d/daed ]; then /etc/init.d/daed stop >/dev/null 2>&1 || :; fi
		printf 'Daed: Operation did not complete. Service was stopped. Backup: %s\n' "${backup:-not created}" >&2
	fi
	exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

while [ "$#" -gt 0 ]; do
	case "$1" in
	--release) [ "$#" -ge 2 ] || fail 'Missing release tag.'; release=$2; shift 2 ;;
	--asset-dir) [ "$#" -ge 2 ] || fail 'Missing asset directory.'; asset_dir=$2; shift 2 ;;
	--install|--uninstall|--reinstall) action=${1#--}; shift ;;
	--check) mode=check; shift ;;
	--dry-run) mode=dry-run; shift ;;
	--help|-h) usage; exit 0 ;;
	*) usage; fail "Unknown option: $1" ;;
	esac
done
[ "$mode" != check ] || [ "$action" = install ] || fail '--check cannot be combined with uninstall/reinstall.'
case "$release" in ''|*[!a-zA-Z0-9._-]*) fail 'Invalid release tag.' ;; esac
[ "$(id -u)" = 0 ] || fail 'Run on the router as root.'
if [ ! -r /etc/openwrt_release ] || ! command -v uci >/dev/null 2>&1; then
	fail 'Requires OpenWrt / ImmortalWrt / iStoreOS.'
fi
if [ "$action" != uninstall ]; then
	[ -r /www/luci-static/resources/luci.js ] || fail 'Install the firmware-provided LuCI first.'
	machine=$(uname -m)
	case "$machine" in x86_64|aarch64) ;; *) fail "Unsupported CPU: $machine" ;; esac
	for tool in jsonfilter sha256sum awk mktemp; do
		command -v "$tool" >/dev/null 2>&1 || fail "Missing tool: $tool"
	done
	[ -r /usr/share/libubox/jshn.sh ] || fail 'Install the firmware-provided jshn package first.'
fi

if command -v apk >/dev/null 2>&1; then
	format=apk
	if [ "$action" != uninstall ]; then
		apk_version=$(apk --version) || fail 'Cannot read apk-tools version.'
		printf '%s\n' "$apk_version" | grep -Eq '^apk-tools v?3\.' || fail 'These APK packages require apk-tools 3.x. Use compatible firmware; no package manager or firmware is replaced.'
		# --print-arch returns APK's compile-time default, not the database's
		# accepted architectures (e.g. aarch64 vs OpenWrt aarch64_generic).
		architectures=''
		if [ -e /etc/apk/arch ]; then
			[ -r /etc/apk/arch ] || fail 'Cannot read /etc/apk/arch.'
			architectures=$(awk 'NF {$1=$1; if (NF!=1 || $1!~/^[a-zA-Z0-9_+-]+$/) exit 1; print $1}' /etc/apk/arch) || fail 'Invalid APK architecture configuration.'
		fi
		# APK itself falls back to its default only when this list is empty.
		if [ -z "$architectures" ]; then
			architectures=$(apk --print-arch) || fail 'Cannot read apk architecture.'
		fi
	fi
elif command -v opkg >/dev/null 2>&1; then
	format=ipk
	architectures=$(opkg print-architecture | awk '$1=="arch" && $2!="all" && $2!="noarch" {print $3, $2}' | sort -rn | awk '{print $2}')
else
	fail 'Neither opkg nor apk is available.'
fi

installed() {
	if [ "$format" = apk ]; then apk info --exists "$1" >/dev/null 2>&1
	else opkg status "$1" 2>/dev/null | grep -q '^Status:.* installed'; fi
}

uninstall_daed() {
	# Only package names belonging to Daed are eligible; never recurse through
	# reverse dependencies or force removal of another application's packages.
	if [ "$format" = apk ]; then names=$(apk info); else names=$(opkg list-installed | awk '{print $1}'); fi
	remove=''
	for package in $names; do
		case "$package" in luci-i18n-daed-*) remove="$remove $package" ;; esac
	done
	# opkg processes removals in order: remove dependents before their runtime.
	for package in luci-app-daed-router luci-app-daed daed-router daed; do
		if installed "$package"; then remove="$remove $package"; fi
	done
	if [ "$mode" = dry-run ]; then
		printf 'Daed: Uninstall dry run; eligible packages:%s. Data would be backed up and cleared.\n' "${remove:- none}"
		return
	fi
	for directory in /etc/daed /root/daed-backups; do
		[ ! -L "$directory" ] || fail "Refusing to clear a symlinked directory: $directory"
	done
	if [ -x /etc/init.d/daed ]; then
		stopped=1
		/etc/init.d/daed stop || fail 'Cannot stop Daed before uninstall.'
	elif pidof daed >/dev/null 2>&1; then
		stopped=1
		killall -TERM daed || fail 'Cannot stop unmanaged Daed.'
	fi
	waited=0
	while pidof daed >/dev/null 2>&1; do
		[ "$waited" -lt 35 ] || fail 'Daed is still running; uninstall and backup were not attempted.'
		sleep 1; waited=$((waited + 1))
	done
	set --
	for path in etc/daed etc/config/daed etc/init.d/daed usr/bin/daed usr/share/daed-router/version; do
		if [ -e "/$path" ] || [ -L "/$path" ]; then set -- "$@" "$path"; fi
	done
	if [ "$#" -gt 0 ]; then
		mkdir -p /root/daed-backups
		chmod 700 /root/daed-backups
		backup="/root/daed-backups/uninstall-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
		tar -czf "$backup" -C / "$@" || fail 'Backup failed; Daed was not removed.'
		chmod 600 "$backup"
		tar -tzf "$backup" >/dev/null || fail 'Backup verification failed; Daed was not removed.'
	fi
	if [ -n "$remove" ]; then
		if [ "$format" = apk ]; then
			# APK automatically removes orphan dependencies. Keep existing BTF
			# and networking/runtime dependencies in world before deleting Daed.
			keep=''
			for package in vmlinux-btf ca-bundle jshn jsonfilter uclient-fetch kmod-sched-core kmod-sched-bpf kmod-veth v2ray-geoip v2ray-geosite luci-base luci-compat rpcd rpcd-mod-luci uhttpd uhttpd-mod-ubus; do
				if installed "$package"; then keep="$keep $package"; fi
			done
			# Each argument is a fixed installed package name, never an option.
			# shellcheck disable=SC2086
			[ -z "$keep" ] || apk add --no-network --no-scripts $keep || fail 'Cannot retain existing runtime dependencies; nothing was uninstalled.'
			# shellcheck disable=SC2086
			apk del $remove || fail 'Package removal failed; backup and remaining data were retained.'
		else
			# shellcheck disable=SC2086
			opkg remove $remove || fail 'Package removal failed; backup and remaining data were retained.'
		fi
		for package in $remove; do
			if installed "$package"; then fail "Package is still installed: $package. Data was retained."; fi
		done
	fi
	[ ! -x /etc/init.d/daed ] || /etc/init.d/daed disable
	# Package scripts must not have restarted Daed before data is cleared.
	if pidof daed >/dev/null 2>&1; then fail 'Daed restarted during removal; data was retained.'; fi
	# Fixed paths only; never follow data directory symlinks or touch other apps.
	rm -rf /etc/daed
	rm -f /etc/config/daed /etc/config/daed.apk-new /etc/config/daed.opkg-dist /etc/init.d/daed /usr/bin/daed /usr/sbin/daed-router-setup
	rm -f /usr/libexec/daed/check /usr/libexec/daed/btf-probe /usr/share/daed-router/version
	rm -f /usr/libexec/daed/luci-proxy /www/cgi-bin/daed-router
	for link in /etc/rc.d/[SK][0-9][0-9]daed; do [ ! -L "$link" ] || rm -f "$link"; done
	/etc/init.d/rpcd reload >/dev/null 2>&1 || :
	printf 'Daed: Uninstalled. Configuration/database backup: %s. Existing BTF retained.\n' "${backup:-no existing data}"
	stopped=0
}

if [ "$action" = uninstall ]; then uninstall_daed; exit 0; fi
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
awk -F '\t' '!/^#/ && NF && (NF!=6 || $1!~/^(ipk|apk|support)$/ || $3!~/^(daed-router|luci-app-daed-router|check|btf-probe)$/) {bad=1} END {exit bad}' "$stage/manifest.tsv" || fail 'Malformed manifest.'

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
case "$machine" in x86_64) probe_cpu=x86_64 ;; aarch64) probe_cpu=arm64 ;; esac
probe_record=$(record support "$probe_cpu" btf-probe) || fail 'Manifest has no unique BTF parser for this CPU.'
[ "$(printf '%s\n' "$probe_record" | cut -f4)" = "btf-probe-$probe_cpu" ] || fail 'Unexpected BTF parser filename.'
[ "$(printf '%s\n' "$probe_record" | cut -f6)" = "$(printf '%s\n' "$support" | cut -f6)" ] || fail 'BTF parser and checker versions do not match.'
verify_record "$probe_record"
chmod 700 "$stage/btf-probe-$probe_cpu"
DAED_BTF_PROBE="$stage/btf-probe-$probe_cpu" sh "$stage/daed-check" --check || fail 'Compatibility check failed. No packages or network settings were changed.'
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

managed=0
if [ "$action" = reinstall ]; then
	printf 'Daed: Fresh reinstall requested. Existing Daed will be backed up, removed and reset.\n'
elif installed daed-router; then
	[ -r /usr/share/daed-router/version ] || fail 'Managed runtime marker is missing; repair the existing installation first.'
	managed=1
elif [ -e /usr/bin/daed ] || [ -e /etc/config/daed ] || [ -e /etc/init.d/daed ] || [ -d /etc/daed ]; then
	fail 'An existing unmanaged Daed installation was found. Back it up and migrate explicitly; it will not be overwritten.'
fi
if [ "$action" != reinstall ] && { installed daed || installed luci-app-daed; }; then fail 'Another Daed package is installed; use --reinstall for a backed-up fresh installation.'; fi
printf 'Daed: %s / %s / %s, release %s\n' "$machine" "$format" "$selected_arch" "$version"

# Native package managers resolve kmods against the router's own feeds/kernel ABI.
# Never force dependencies or add a feed for a different firmware.
if [ "$mode" != dry-run ]; then
	if [ "$format" = apk ]; then apk update; else opkg update; fi
fi
# APK resolves architecture and dependencies before stopping/uninstalling Daed.
# --simulate opens the database read-only and uses existing index caches.
# Do not add --no-network: APK would mask uncached packages in HTTP(S) feeds.
if [ "$format" = apk ]; then
	apk add --simulate --allow-untrusted "$stage/$runtime_file" "$stage/$plugin_file" || fail 'Package preflight failed. Daed was not stopped or uninstalled. Check firmware feeds/dependencies; dry runs require cached indexes.'
fi
[ "$mode" != dry-run ] || { printf 'Daed: Dry run passed; no packages, configuration or services changed.\n'; exit 0; }
if [ "$action" = reinstall ]; then uninstall_daed; stopped=1; fi
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
if [ ! -x /usr/bin/daed ] || [ ! -x /usr/libexec/daed/check ] || \
	[ ! -x /usr/libexec/daed/luci-proxy ] || [ ! -x /www/cgi-bin/daed-router ]; then fail 'Installed runtime or LuCI gateway is incomplete.'; fi
for asset in geosite.dat geoip.dat; do
	if [ ! -s "/etc/daed/$asset" ] && [ ! -s "/usr/local/share/daed/$asset" ] && [ ! -s "/usr/share/daed/$asset" ]; then
		fail "Installed rule data is unavailable: $asset. Repair the firmware's v2ray-geosite/v2ray-geoip packages and daed-router search-path links."
	fi
done
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
