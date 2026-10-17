"""Exercise dependency retention using real APK v3 in a disposable OpenWrt rootfs."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import unittest

import test_router


class NativeAPKUninstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        location = os.environ.get("DAED_TEST_APK")
        if not location:
            raise unittest.SkipTest("Set DAED_TEST_APK to an x86_64 OpenWrt SDK host/bin/apk")
        test_router.RouterTests.setUpClass()
        cls.apk = Path(location).resolve()

    def test_real_apk_uninstall_keeps_orphan_btf_and_backs_up_data(self):
        case = test_router.RouterTests()
        case.setUp()
        try:
            case.legacy()
            host_lib = self.apk.parent.parent / "lib"
            loader = host_lib / "ld-linux-x86-64.so.2"
            binary = self.apk.parent / ".apk.bin"
            libraries = subprocess.check_output([str(loader), "--library-path", str(host_lib), "--list", str(binary)], text=True)
            for item in re.findall(r"=> (/\S+)", libraries):
                case.write("/opt/apk-host/" + Path(item).name, Path(item).read_bytes(), True)
            case.write("/opt/apk-host/ld.so", loader.read_bytes(), True)
            case.write("/opt/apk-host/apk", binary.read_bytes(), True)
            case.script("/bin/apk", 'exec /opt/apk-host/ld.so --library-path /opt/apk-host /opt/apk-host/apk "$@"')
            directory = Path(case.temp.name)
            packages = []
            definitions = [
                ("vmlinux-btf", "6.6.73", "", {"usr/lib/debug/boot/vmlinux-6.6.73": b"BTF retention fixture"}),
                ("daed", "1-r1", "vmlinux-btf", {
                    "usr/bin/daed": b"old binary fixture",
                    "etc/init.d/daed": (case.root / "fixtures/daed-init").read_bytes(),
                    "etc/config/daed": b"config daed 'config'\n option enabled '1'\n",
                }),
                ("luci-app-daed", "1-r1", "daed", {"usr/share/old-daed-ui": b"fixture"}),
            ]
            for name, version, depends, files in definitions:
                payload = directory / ("payload-" + name)
                for relative, data in files.items():
                    target = payload / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    target.chmod(0o755)
                package = directory / (name + ".apk")
                args = [str(self.apk), "mkpkg", "--info", "name:" + name, "--info", "version:" + version, "--info", "arch:x86_64", "--files", str(payload), "--output", str(package)]
                if depends:
                    args += ["--info", "depends:" + depends]
                subprocess.run(args, check=True, capture_output=True)
                packages.append(str(package))
            # vmlinux-btf is initially a dependency, not a world entry.
            subprocess.run([str(self.apk), "--root", str(case.root), "add", "--initdb", "--no-scripts", "--allow-untrusted", *packages], check=True, capture_output=True)
            world = case.root / "etc/apk/world"
            world.write_text("luci-app-daed\n")
            names = case.run_router("apk", "info")
            self.assertEqual(names.returncode, 0, names.stderr)
            self.assertIn("daed", names.stdout.splitlines())
            result = case.install("--uninstall")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual(case.run_router("apk", "info", "--exists", "vmlinux-btf").returncode, 0)
            self.assertNotEqual(case.run_router("apk", "info", "--exists", "daed").returncode, 0)
            self.assertTrue((case.root / "usr/lib/debug/boot/vmlinux-6.6.73").exists())
            self.assertIn("vmlinux-btf", world.read_text())
            self.assertFalse((case.root / "etc/daed").exists())
            backup = next((case.root / "root/daed-backups").glob("*.tar.gz"))
            with tarfile.open(backup) as archive:
                self.assertEqual(archive.extractfile("etc/daed/wing.db-wal").read(), b"old WAL")
        finally:
            case.tearDown()
