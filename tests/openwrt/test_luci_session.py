"""Validate the gateway against real OpenWrt ubusd/rpcd sessions in a chroot."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time
import unittest

import test_router


class LuCISessionTests(unittest.TestCase):
    def test_native_rpcd_login_permissions_and_logout(self):
        binary = os.environ.get("DAED_TEST_LUCI_PROXY")
        if not binary:
            self.skipTest("Set DAED_TEST_LUCI_PROXY to the compiled x86_64 gateway")
        test_router.RouterTests.setUpClass()
        case = test_router.RouterTests()
        case.setUp()
        processes = []
        try:
            # Replace the shell fixture with the firmware's actual ubus client.
            (case.root / "bin/ubus").unlink()
            shutil.copy2(case.base / "bin/ubus", case.root / "bin/ubus", follow_symlinks=True)
            case.write("/usr/libexec/daed/luci-proxy", Path(binary).read_bytes(), True)
            case.write("/usr/share/rpcd/acl.d/luci-app-daed-router.json", (test_router.OPENWRT / "files/acl.json").read_bytes())
            # rpcd and the native TLS/crypto libraries require real devices.
            (case.root / "dev/null").unlink()
            for name, minor in (("null", 3), ("urandom", 9)):
                os.mknod(case.root / "dev" / name, stat.S_IFCHR | 0o666, os.makedev(1, minor))
            password_hash = subprocess.check_output(["openssl", "passwd", "-6", "-salt", "daedtest", "fixture-password"], text=True).strip()
            case.write("/etc/config/rpcd", "config rpcd\n option socket '/var/run/ubus/ubus.sock'\nconfig login\n option username 'fixture-admin'\n option password '" + password_hash + "'\n list read '*'\n list write '*'\nconfig login\n option username 'fixture-reader'\n option password '" + password_hash + "'\n list read 'luci-app-daed-router'\n")
            (case.root / "var/run/ubus").mkdir(parents=True, exist_ok=True)
            processes.append(subprocess.Popen(["chroot", str(case.root), "/sbin/ubusd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            for _ in range(50):
                if (case.root / "var/run/ubus/ubus.sock").exists(): break
                time.sleep(0.05)
            processes.append(subprocess.Popen(["chroot", str(case.root), "/sbin/rpcd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

            def ubus(method, data):
                result = case.run_router("/bin/ubus", "call", "session", method, json.dumps(data))
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout) if result.stdout.strip() else {}

            for _ in range(50):
                result = case.run_router("/bin/ubus", "list", "session")
                if "session" in result.stdout: break
                time.sleep(0.05)

            def bootstrap(session, overrides=None):
                body = json.dumps({"session": session})
                environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "REQUEST_METHOD": "POST", "SCRIPT_NAME": "/cgi-bin/daed-router", "PATH_INFO": "/session", "REQUEST_URI": "/cgi-bin/daed-router/session", "SERVER_PROTOCOL": "HTTP/1.1", "GATEWAY_INTERFACE": "CGI/1.1", "SERVER_NAME": "router.test", "SERVER_PORT": "443", "HTTP_HOST": "router.test", "HTTPS": "on", "HTTP_ORIGIN": "https://router.test", "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": str(len(body))}
                environment.update(overrides or {})
                return subprocess.run(["chroot", str(case.root), "/usr/libexec/daed/luci-proxy"], input=body, text=True, capture_output=True, env=environment, timeout=10).stdout

            admin = ubus("login", {"username": "fixture-admin", "password": "fixture-password"})["ubus_rpc_session"]
            self.assertIn("Status: 204", bootstrap(admin))
            self.assertIn("Secure", bootstrap(admin))
            for overrides in [
                {"HTTP_HOST": "ROUTER.test:443"},
                {"HTTPS": "1"},
                {"REQUEST_URI": ""},
                {"HTTPS": "", "SERVER_PORT": "80", "HTTP_HOST": "router.test:80", "HTTP_ORIGIN": "http://router.test"},
                {"SERVER_PORT": "8443", "HTTP_HOST": "router.test:8443", "HTTP_ORIGIN": "https://router.test:8443"},
                {"SERVER_NAME": "::1", "HTTP_HOST": "[::1]:443", "HTTP_ORIGIN": "https://[::1]"},
            ]:
                with self.subTest(cgi=overrides):
                    self.assertIn("Status: 204", bootstrap(admin, overrides))
            for origin in ["https://evil.test", "http://router.test", "null", ""]:
                denied = bootstrap(admin, {"HTTP_ORIGIN": origin})
                self.assertIn("Status: 403", denied)
                self.assertIn("origin_rejected", denied)
            reader = ubus("login", {"username": "fixture-reader", "password": "fixture-password"})["ubus_rpc_session"]
            self.assertIn("Status: 403", bootstrap(reader))
            self.assertIn("permission_denied", bootstrap(reader))
            ubus("destroy", {"ubus_rpc_session": admin})
            self.assertIn("Status: 401", bootstrap(admin))
            self.assertIn("session_expired", bootstrap(admin))
            processes[-1].terminate()
            processes[-1].wait(timeout=5)
            unavailable = bootstrap(reader)
            self.assertIn("Status: 503", unavailable)
            self.assertIn("rpc_unavailable", unavailable)
        finally:
            for process in reversed(processes): process.terminate()
            for process in reversed(processes): process.wait(timeout=5)
            case.tearDown()
