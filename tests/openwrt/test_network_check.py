"""Read-only diagnostics with real BusyBox/jsonfilter and synthetic probes."""
import json
from pathlib import Path
import unittest

import test_router as router_fixture


class NetworkCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        router_fixture.RouterTests.setUpClass()

    def setUp(self):
        self.router = router_fixture.RouterTests()
        self.router.setUp()
        self.root = self.router.root
        source = Path(__file__).resolve().parents[2] / "openwrt/network-check.sh"
        self.router.write("/fixtures/network-check", source.read_bytes(), True)
        self.router.write("/etc/config/daed", "config daed 'main'\n option lan_network 'lan'\n")
        self.router.write("/tmp/logs", json.dumps({"logs": 'time="14:06:48" level=info msg="Bind to LAN: eth0"\nlevel=error msg="DNS https://user:private-secret@host/path?token=private-secret token=private-token 11111111-1111-4111-8111-111111111111"'}))
        self.router.script("/bin/ubus", '''echo "$*" >> /tmp/ubus-calls
case "$2.$3" in
 network.interface.lan.status) echo '{"up":true,"l3_device":"br-lan"}' ;;
 network.interface.wan.status|network.interface.wan6.status) echo '{"up":true,"l3_device":"eth0"}' ;;
 service.list) echo '{"daed":{"instances":{"main":{"running":true}}},"passwall":{"instances":{"main":{"running":false}}}}' ;;
 daed-router.logs) cat /tmp/logs ;;
 *) exit 1 ;;
esac''')
        self.router.script("/bin/ip", '''[ "$*" = '-4 route show default' ] || exit 0
echo 'default via 192.0.2.1 dev eth0' ''')
        self.router.script("/bin/tc", 'echo "$*" >> /tmp/tc-calls; echo "filter bpf dae-fixture"')
        self.router.script("/bin/nslookup", 'echo "$*" >> /tmp/dns-calls; echo "Address: 192.0.2.2"')
        self.router.script("/bin/curl", '''echo "$*" >> /tmp/curl-calls
case "$*" in *-6*) echo 'http=000 peer='; exit 7 ;; *) echo 'http=200 peer=192.0.2.2' ;; esac''')

    def tearDown(self):
        self.router.tearDown()

    def run_check(self):
        return self.router.run_router("/bin/sh", "/fixtures/network-check")

    def test_collects_devices_routes_probes_and_bindings_without_config_or_service_changes(self):
        before = (self.root / "etc/config/daed").read_bytes()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("network=lan up=true device=br-lan", result.stdout)
        self.assertIn("passwall running=no", result.stdout)
        self.assertIn("Bind to LAN: eth0", result.stdout)
        self.assertEqual(before, (self.root / "etc/config/daed").read_bytes())
        calls = (self.root / "tmp/tc-calls").read_text().splitlines()
        self.assertTrue(calls and all(line.startswith("filter show dev ") for line in calls))
        self.assertFalse((self.root / "tmp/service-calls").exists())
        curl = (self.root / "tmp/curl-calls").read_text().splitlines()
        self.assertEqual(len(curl), 3)
        self.assertTrue(all('--max-time 8' in call and '--noproxy *' in call for call in curl))
        self.assertIn("curl_exit=7", result.stdout)

    def test_logs_hide_credentials_and_injected_device_names_are_not_executed(self):
        self.router.script("/bin/ubus", '''case "$2" in
 network.interface.*) echo '{"up":true,"l3_device":"$(touch /tmp/unsafe)"}' ;;
 daed-router) cat /tmp/logs ;;
 *) echo '{}' ;;
esac''')
        result = self.run_check()
        for secret in ("private-secret", "private-token", "11111111-1111-4111-8111-111111111111"):
            self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertFalse((self.root / "tmp/unsafe").exists())
        self.assertFalse((self.root / "tmp/tc-calls").exists())

    def test_missing_optional_probes_does_not_install_or_modify_anything(self):
        (self.root / "bin/curl").unlink()
        (self.root / "bin/tc").unlink()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("nothing installed", result.stdout)
        self.assertIn("tc unavailable", result.stdout)
        calls = self.root / "tmp/pm-calls"
        self.assertFalse(calls.exists() and calls.read_text().strip())
