"""Actual BusyBox/UCI discovery, with a synthetic PassWall Lua cache."""
from pathlib import Path
import unittest

import test_router as router_fixture


class SubscriptionProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        router_fixture.RouterTests.setUpClass()

    def setUp(self):
        self.router = router_fixture.RouterTests()
        self.router.setUp()
        self.root = self.router.root
        self.router.write("/etc/config/daed", "config daed 'main'\n option subscription_proxy 'auto'\n")
        source = Path(__file__).resolve().parents[2] / "openwrt/files/subscription-proxy"
        self.router.write("/fixtures/subscription-proxy", source.read_bytes(), True)
        self.router.script("/bin/lua", '''case "$2" in
 *GLOBAL_SOCKS_server*) cat /tmp/proxy-address 2>/dev/null ;;
 *) echo '26.10.1' ;;
esac''')
        self.router.write("/tmp/proxy-address", "127.0.0.1:1070")

    def tearDown(self):
        self.router.tearDown()

    def discover(self):
        return self.router.run_router("/bin/sh", "/fixtures/subscription-proxy")

    def test_default_and_legacy_configuration_use_auto_without_mutation(self):
        self.router.run_router("/sbin/uci", "delete", "daed.main.subscription_proxy")
        self.router.run_router("/sbin/uci", "commit", "daed")
        before = (self.root / "etc/config/daed").read_bytes()
        result = self.discover()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "auto\n127.0.0.1:1070\npasswall/26.10.1\n")
        self.assertEqual(before, (self.root / "etc/config/daed").read_bytes())

    def test_loopback_endpoints_and_changed_port(self):
        for address, expected in [("localhost:1234", "localhost:1234"), ("[::1]:2234", "[::1]:2234"), ("0.0.0.0:3234", "127.0.0.1:3234")]:
            with self.subTest(address=address):
                self.router.write("/tmp/proxy-address", address)
                self.assertIn("\n" + expected + "\n", self.discover().stdout)

    def test_invalid_external_or_credentialed_cache_is_rejected(self):
        for address in ("192.0.2.1:1080", "user:secret@127.0.0.1:1080", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:1\nsecret", "[::1]:foo"):
            with self.subTest(address=address):
                self.router.write("/tmp/proxy-address", address)
                result = self.discover()
                self.assertEqual(result.stdout, "auto\n\npasswall/26.10.1\n")
                self.assertNotIn("secret", result.stderr)

    def test_off_does_not_query_passwall_and_invalid_mode_fails(self):
        self.router.script("/bin/lua", "touch /tmp/lua-called; echo secret")
        self.router.run_router("/sbin/uci", "set", "daed.main.subscription_proxy=off")
        self.assertEqual(self.discover().stdout, "off\n")
        self.assertFalse((self.root / "tmp/lua-called").exists())
        self.router.run_router("/sbin/uci", "set", "daed.main.subscription_proxy=unknown")
        result = self.discover()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("secret", result.stdout + result.stderr)

    def test_missing_passwall_is_allowed_for_auto_and_reported_for_force(self):
        self.router.script("/bin/lua", "exit 1")
        self.assertEqual(self.discover().stdout, "auto\n\npasswall\n")
        self.router.run_router("/sbin/uci", "set", "daed.main.subscription_proxy=passwall")
        self.assertEqual(self.discover().stdout, "passwall\n\npasswall\n")
