"""Installer/RPC failure-path tests in a disposable OpenWrt chroot.

Runs real BusyBox ash, UCI, jshn and jsonfilter. Kernel, network, service manager
and package managers are fixtures; this is not a router or eBPF traffic test.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]
OPENWRT = PROJECT / "openwrt"


class RouterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        location = os.environ.get("DAED_TEST_ROOTFS")
        if not location or os.geteuid() != 0:
            raise unittest.SkipTest("Requires root and DAED_TEST_ROOTFS pointing to the checksum-verified OpenWrt rootfs")
        cls.base = Path(location)

    def write(self, name, data, executable=False):
        path = self.root / name.lstrip("/")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            path.unlink()
        if isinstance(data, bytes):
            path.write_bytes(data)
        else:
            path.write_text(data)
        if executable:
            path.chmod(0o755)
        return path

    def script(self, name, body):
        return self.write(name, "#!/bin/sh\n" + body + "\n", True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="daed-router-test-")
        self.root = Path(self.temp.name) / "root"
        shutil.copytree(self.base, self.root, symlinks=True)
        (self.root / "tmp").mkdir(exist_ok=True)
        self.write("/dev/null", "")
        self.write("/www/luci-static/resources/luci.js", "// fixture\n")
        self.write("/etc/openwrt_release", "DISTRIB_ID='OpenWrt'\nDISTRIB_RELEASE='test'\n")
        self.write("/tmp/machine", "x86_64\n")
        self.write("/tmp/kernel", "6.6.73\n")
        self.write("/tmp/arch", "x86_64\n")
        self.write("/tmp/services", "{}\n")
        self.write("/sys/kernel/btf/vmlinux", "fixture only\n")
        options = "BPF BPF_SYSCALL BPF_JIT CGROUPS KPROBES NET_INGRESS NET_EGRESS NET_SCH_INGRESS NET_CLS_BPF NET_CLS_ACT BPF_STREAM_PARSER KPROBE_EVENTS BPF_EVENTS"
        self.write("/proc/config.gz", gzip.compress("".join("CONFIG_" + option + "=y\n" for option in options.split()).encode()))
        self.write("/etc/config/daed", (OPENWRT / "files/daed.config").read_bytes())
        self.script("/bin/uname", 'if [ "$1" = -m ]; then cat /tmp/machine; else cat /tmp/kernel; fi')
        self.script("/bin/ubus", '''case "$2" in
network.interface.*) echo '{"ipv4-address":[{"address":"192.168.8.1"}]}' ;;
service) cat /tmp/services ;;
*) exit 1 ;;
esac''')
        self.script("/bin/pidof", '[ -e /tmp/daemon-running ]')
        self.script("/bin/uclient-fetch", '[ ! -e /tmp/http-fail ]')
        self.script("/etc/init.d/rpcd", 'echo "rpcd $*" >> /tmp/service-calls')
        self.script("/fixtures/daed-init", '''echo "$*" >> /tmp/service-calls
case "$1" in
start|restart)
 if [ "$(uci -q get daed.main.enabled)" = 1 ]; then
  touch /tmp/daemon-running
  echo '{"daed":{"instances":{"main":{"running":true}}}}' > /tmp/services
 fi ;;
stop) rm -f /tmp/daemon-running; echo '{}' > /tmp/services ;;
enabled) [ -f /tmp/autostart ] ;;
enable) touch /tmp/autostart ;;
disable) rm -f /tmp/autostart ;;
esac''')
        self.write("/fixtures/check", (OPENWRT / "files/daed-check").read_bytes(), True)
        self.write("/installer/install.sh", (OPENWRT / "install.sh").read_bytes(), True)
        self.script("/fixtures/install", '''[ ! -e /tmp/pm-fail ] || exit 17
mkdir -p /usr/libexec/daed /usr/share/daed-router /etc/daed
cp /fixtures/check /usr/libexec/daed/check
cp /fixtures/daed-init /etc/init.d/daed
echo '#!/bin/sh' > /usr/bin/daed
chmod +x /usr/bin/daed
echo 0.1.0-1 > /usr/share/daed-router/version
touch /tmp/installed-daed-router /tmp/installed-luci-app-daed-router''')
        self.script("/bin/opkg", '''echo "$*" >> /tmp/pm-calls
case "$1" in
print-architecture) echo 'arch all 1'; printf 'arch %s 10\\n' "$(cat /tmp/arch)" ;;
status) [ -f "/tmp/installed-$2" ] && echo 'Status: install ok installed' ;;
update) exit 0 ;;
install) /fixtures/install ;;
*) exit 1 ;;
esac''')
        # The checked-in default config would be treated as an unmanaged install.
        (self.root / "etc/config/daed").unlink()
        self.write("/fixtures/daed.config", (OPENWRT / "files/daed.config").read_bytes())
        with open(self.root / "fixtures/install", "a") as stream:
            stream.write('\n[ -e /etc/config/daed ] || cp /fixtures/daed.config /etc/config/daed\n')
        self.assets()

    def tearDown(self):
        self.temp.cleanup()

    def assets(self, fmt="ipk", arch="x86_64", version="0.1.0"):
        records = []
        for package, architecture, filename, content in [
            ("daed-router", arch, "runtime." + fmt, b"package manager fixture, not a real runtime"),
            ("luci-app-daed-router", "all", "luci." + fmt, b"LuCI package fixture"),
            ("check", "all", "daed-check", (OPENWRT / "files/daed-check").read_bytes()),
        ]:
            self.write("/assets/" + filename, content)
            records.append("\t".join(["support" if package == "check" else fmt, architecture, package, filename, hashlib.sha256(content).hexdigest(), version]))
        self.write("/assets/manifest.tsv", "# daed-openwrt-manifest-v1\n" + "\n".join(records) + "\n")

    def run_router(self, *args, input=None):
        return subprocess.run(["chroot", str(self.root), *args], input=input, capture_output=True, text=True, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}, timeout=60)

    def install(self, *args):
        return self.run_router("/bin/sh", "/installer/install.sh", "--asset-dir", "/assets", *args)

    def check(self, *args):
        return self.run_router("/bin/sh", "/fixtures/check", *args)

    def use_apk(self, machine="aarch64", architecture="aarch64_cortex-a53"):
        self.write("/tmp/machine", machine + "\n")
        self.write("/tmp/arch", architecture + "\n")
        self.script("/bin/apk", '''echo "$*" >> /tmp/pm-calls
case "$1" in
--version) if [ -e /tmp/apk-version ]; then cat /tmp/apk-version; else echo 'apk-tools 3.0.5'; fi ;;
--print-arch) cat /tmp/arch ;;
info) [ -f "/tmp/installed-$3" ] ;;
update) exit 0 ;;
add) /fixtures/install ;;
*) exit 1 ;;
esac''')
        self.assets("apk", architecture)

    def managed(self, running=True):
        self.run_router("/fixtures/install")
        self.run_router("/sbin/uci", "set", "daed.main.enabled=1")
        self.run_router("/sbin/uci", "commit", "daed")
        if running:
            self.run_router("/etc/init.d/daed", "start")

    def test_all_firmware_ids(self):
        for firmware in ("OpenWrt", "ImmortalWrt", "iStoreOS"):
            self.write("/etc/openwrt_release", "DISTRIB_ID='" + firmware + "'\nDISTRIB_RELEASE='test'\n")
            result = self.check("--check")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual(json.loads(result.stdout)["firmware"], firmware)

    def test_old_kernel_and_missing_btf_are_rejected(self):
        self.write("/tmp/kernel", "5.15.100\n")
        self.assertNotEqual(self.install().returncode, 0)
        self.write("/tmp/kernel", "6.6.73\n")
        (self.root / "sys/kernel/btf/vmlinux").unlink()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("update", (self.root / "tmp/pm-calls").read_text())

    def test_missing_kernel_config_is_an_explicit_warning(self):
        (self.root / "proc/config.gz").unlink()
        data = json.loads(self.check().stdout)
        self.assertTrue(data["compatible"])
        self.assertIn("warning", [row["status"] for row in data["checks"]])

    def test_missing_required_kernel_option_fails(self):
        self.write("/proc/config.gz", gzip.compress(b"CONFIG_BPF=y\n"))
        self.assertNotEqual(self.check("--check").returncode, 0)

    def test_unmanaged_installation_is_preserved(self):
        path = self.write("/usr/bin/daed", "existing binary")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(path.read_text(), "existing binary")
        self.assertIn("unmanaged", result.stderr)

    def test_bad_checksum_stops_before_package_changes(self):
        self.write("/assets/runtime.ipk", "tampered")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checksum mismatch", result.stderr)
        self.assertNotIn("update", (self.root / "tmp/pm-calls").read_text())

    def test_architecture_mismatch_has_no_forced_fallback(self):
        self.write("/tmp/arch", "aarch64_cortex-a53\n")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No ipk runtime", result.stderr)

    def test_duplicate_and_traversal_manifest_records_fail(self):
        manifest = self.root / "assets/manifest.tsv"
        original = manifest.read_text()
        manifest.write_text(original + original.splitlines()[1] + "\n")
        self.assertNotEqual(self.install().returncode, 0)
        manifest.write_text(original.replace("runtime.ipk", "../runtime.ipk"))
        self.assertNotEqual(self.install().returncode, 0)

    def test_mismatched_versions_fail(self):
        manifest = self.root / "assets/manifest.tsv"
        manifest.write_text(manifest.read_text().replace("luci.ipk\t", "luci.ipk\t").replace("\t0.1.0\n", "\t0.2.0\n", 1))
        self.assertNotEqual(self.install().returncode, 0)

    def test_dry_run_never_installs_or_starts(self):
        result = self.install("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertNotIn("update", (self.root / "tmp/pm-calls").read_text())
        self.assertFalse((self.root / "tmp/daemon-running").exists())

    def test_source_check_works_before_a_release_and_cleans_staging(self):
        self.write("/installer/files/daed-check", (OPENWRT / "files/daed-check").read_bytes())
        result = self.install("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["compatible"])
        self.assertNotIn("update", (self.root / "tmp/pm-calls").read_text())
        self.assertFalse(list((self.root / "tmp").glob("daed-install.*")))

    def test_wildcard_management_bind_is_rejected(self):
        self.managed(False)
        self.run_router("/sbin/uci", "set", "daed.main.listen_host=0.0.0.0")
        self.run_router("/sbin/uci", "commit", "daed")
        self.assertNotEqual(self.check("--check").returncode, 0)

    def test_installer_ipk_and_apk_paths(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue((self.root / "tmp/daemon-running").exists())
        self.assertTrue((self.root / "tmp/autostart").exists())
        self.use_apk()
        result = self.install("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("aarch64 / apk / aarch64_cortex-a53", result.stdout)

    def test_old_apk_format_is_rejected_before_changes(self):
        self.use_apk()
        self.write("/tmp/apk-version", "apk-tools 2.14.4\n")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("apk-tools 3.x", result.stderr)
        self.assertNotIn("update", (self.root / "tmp/pm-calls").read_text())

    def test_upgrade_stops_before_consistent_backup_and_preserves_boot_choice(self):
        self.managed()
        self.write("/etc/daed/wing.db", "database fixture")
        self.write("/etc/daed/wing.db-wal", "WAL fixture")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        backups = list((self.root / "root/daed-backups").glob("*.tar.gz"))
        self.assertEqual(len(backups), 1)
        with tarfile.open(backups[0]) as archive:
            self.assertEqual(archive.extractfile("etc/daed/wing.db-wal").read(), b"WAL fixture")
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / "tmp/autostart").exists())

    def test_package_failure_leaves_service_stopped_and_backup_available(self):
        self.managed()
        self.write("/tmp/pm-fail", "1")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "tmp/daemon-running").exists())
        self.assertTrue(list((self.root / "root/daed-backups").glob("*.tar.gz")))

    def test_rpc_rejects_shell_injection_and_handles_no_newline(self):
        self.managed()
        self.write("/usr/libexec/rpcd/daed-router", (OPENWRT / "files/rpcd-daed").read_bytes(), True)
        result = self.run_router("/usr/libexec/rpcd/daed-router", "call", "action", input=json.dumps({"action": "start; touch /tmp/pwned"}))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)["success"])
        self.assertFalse((self.root / "tmp/pwned").exists())
        result = self.run_router("/usr/libexec/rpcd/daed-router", "call", "action", input='{"action":"stop"}')
        self.assertTrue(json.loads(result.stdout)["success"])
        self.assertFalse((self.root / "tmp/daemon-running").exists())

    def test_sensitive_log_links_are_masked(self):
        self.managed(False)
        self.write("/usr/libexec/rpcd/daed-router", (OPENWRT / "files/rpcd-daed").read_bytes(), True)
        self.write("/var/log/daed/daed.log", "https://user:secret@host/sub?token=secret password=abc ss://private-node\n")
        result = self.run_router("/usr/libexec/rpcd/daed-router", "call", "logs")
        logs = json.loads(result.stdout)["logs"]
        for secret in ("secret", "abc", "private-node"):
            self.assertNotIn(secret, logs)

    def test_rpc_log_read_is_bounded_for_a_giant_single_line(self):
        self.managed(False)
        self.write("/usr/libexec/rpcd/daed-router", (OPENWRT / "files/rpcd-daed").read_bytes(), True)
        self.write("/var/log/daed/daed.log", "x" * (1024 * 1024))
        result = self.run_router("/usr/libexec/rpcd/daed-router", "call", "logs")
        self.assertLessEqual(len(json.loads(result.stdout)["logs"]), 32768)


if __name__ == "__main__":
    unittest.main()
