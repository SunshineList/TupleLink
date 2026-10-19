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
        self.router.write("/tmp/services", json.dumps({"daed": {"instances": {"main": {"running": True}}}, "passwall": {"instances": {"main": {"running": False}}}}))
        self.router.write("/tmp/logs", json.dumps({"logs": 'time="14:06:48" level=info msg="Bind to LAN: eth0"\nlevel=error msg="DNS https://user:private-secret@host/path?token=private-secret token=private-token 11111111-1111-4111-8111-111111111111"'}))
        self.router.script("/usr/sbin/ubus", '''echo "$*" >> /tmp/ubus-calls
case "$2.$3" in
 network.interface.lan.status) echo '{"up":true,"l3_device":"br-lan"}' ;;
 network.interface.wan.status|network.interface.wan6.status) echo '{"up":true,"l3_device":"eth0"}' ;;
 service.list)
  [ ! -f /tmp/services-fail ] || exit 1
  if [ -f /tmp/probes-completed ] && [ -f /tmp/services-after ]; then cat /tmp/services-after; else cat /tmp/services; fi ;;
 daed-router.logs)
  if [ -f /tmp/probes-completed ] && [ -f /tmp/logs-after ]; then cat /tmp/logs-after; else cat /tmp/logs; fi ;;
 *) exit 1 ;;
esac''')
        self.router.script("/usr/sbin/ip", '''[ "$*" = '-4 route show default' ] || exit 0
echo 'default via 192.0.2.1 dev eth0' ''')
        self.router.script("/usr/sbin/tc", 'echo "$*" >> /tmp/tc-calls; echo "filter bpf dae-fixture"')
        self.router.script("/usr/sbin/nslookup", 'echo "$*" >> /tmp/dns-calls; echo "Address: 192.0.2.2"')
        self.router.script("/usr/sbin/curl", '''echo "$*" >> /tmp/curl-calls
touch /tmp/probes-completed
case "$*" in *-6*) echo 'http=000 peer='; exit 7 ;; *) echo 'http=200 peer=192.0.2.2' ;; esac''')
        self.router.script("/usr/sbin/timeout", 'echo "$*" >> /tmp/timeout-calls; shift; exec "$@"')
        self.router.script("/usr/sbin/pidof", '[ "$1" = daed ]')
        self.router.script("/usr/sbin/nft", '''echo "$*" >> /tmp/nft-calls
echo 'table inet fw4 { chain input { comment "fixture-private-secret"; } }' ''')
        for tool in ("iptables-save", "ip6tables-save"):
            self.router.script("/usr/sbin/" + tool, 'echo "read" >> /tmp/iptables-calls; echo "*filter"')

    def tearDown(self):
        self.router.tearDown()

    def run_check(self):
        return self.router.run_router("/bin/sh", "/fixtures/network-check")

    def test_collects_devices_routes_probes_and_bindings_without_config_or_service_changes(self):
        before = (self.root / "etc/config/daed").read_bytes()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("network=lan up=true device=br-lan", result.stdout)
        self.assertIn("service=passwall procd=stopped", result.stdout)
        self.assertIn("service=passwall2 procd=unreported", result.stdout)
        self.assertIn("process=daed state=present", result.stdout)
        self.assertIn("default via 192.0.2.1 dev eth0", result.stdout)
        self.assertIn("Bind to LAN: eth0", result.stdout)
        self.assertIn("new_log_lines=0", result.stdout)
        self.assertIn("traffic_owner=unknown", result.stdout)
        self.assertNotIn("fixture-private-secret", result.stdout + result.stderr)
        self.assertEqual((self.root / "tmp/nft-calls").read_text().splitlines(), ["list ruleset"])
        self.assertEqual((self.root / "tmp/iptables-calls").read_text().splitlines(), ["read", "read"])
        self.assertEqual((self.root / "tmp/timeout-calls").read_text().splitlines(), [
            "6 nft list ruleset", "6 iptables-save", "6 ip6tables-save", "6 nslookup www.google.com 127.0.0.1",
        ])
        self.assertEqual(before, (self.root / "etc/config/daed").read_bytes())
        calls = (self.root / "tmp/tc-calls").read_text().splitlines()
        self.assertTrue(calls and all(line.startswith("filter show dev ") for line in calls))
        self.assertFalse((self.root / "tmp/service-calls").exists())
        curl = (self.root / "tmp/curl-calls").read_text().splitlines()
        self.assertEqual(len(curl), 3)
        self.assertTrue(all('--max-time 8' in call and '--noproxy *' in call for call in curl))
        self.assertIn("curl_exit=7", result.stdout)
        calls = (self.root / "tmp/ubus-calls").read_text().splitlines()
        self.assertEqual(calls.count("call service list"), 2)
        self.assertEqual(calls.count("call daed-router logs"), 2)

    def test_logs_hide_credentials_and_injected_device_names_are_not_executed(self):
        self.router.script("/usr/sbin/ubus", '''case "$2" in
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
        (self.root / "usr/sbin/curl").unlink()
        (self.root / "usr/sbin/tc").unlink()
        (self.root / "usr/sbin/nft").unlink()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("nothing installed", result.stdout)
        self.assertIn("tc unavailable", result.stdout)
        self.assertIn("nft unavailable", result.stdout)
        calls = self.root / "tmp/pm-calls"
        self.assertFalse(calls.exists() and calls.read_text().strip())

    def test_unreported_passwall_with_core_and_firewall_markers_is_not_treated_as_stopped(self):
        self.router.write("/tmp/services", '{"daed":{"instances":{"main":{"running":true}}}}')
        self.router.script("/usr/sbin/pidof", 'case "$1" in daed|xray) exit 0 ;; *) exit 1 ;; esac')
        self.router.script("/usr/sbin/nft", '''echo 'chain PSW_RULE { comment "private-rule-secret"; }'
echo 'chain PSW2_OUTPUT { }' ''')
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("service=passwall procd=unreported", result.stdout)
        self.assertIn("process=xray state=present", result.stdout)
        self.assertIn("nft passwall_marker_lines=2", result.stdout)
        self.assertIn("traffic_owner=unknown", result.stdout)
        self.assertNotIn("private-rule-secret", result.stdout + result.stderr)
        self.assertNotIn("PSW2_OUTPUT", result.stdout + result.stderr)
        self.assertNotIn("passwall running=no", result.stdout)

    def test_failed_queries_are_unknown_not_negative_observations(self):
        self.router.write("/tmp/services-fail", "")
        self.router.script("/usr/sbin/nft", 'echo "private-query-error" >&2; exit 1')
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("service=passwall procd=unavailable", result.stdout)
        self.assertIn("nft query=unavailable", result.stdout)
        self.assertNotIn("nft passwall_marker_lines=0", result.stdout)
        self.assertNotIn("private-query-error", result.stdout + result.stderr)

    def test_reports_service_changes_after_probes(self):
        self.router.write("/tmp/services-after", '{"passwall":{"instances":{"main":{"running":true}}}}')
        result = self.run_check()
        before, after = result.stdout.split("[Service/process snapshot: after-probes]")
        self.assertIn("service=passwall procd=stopped", before)
        self.assertIn("service=passwall procd=running", after)
        self.assertIn("service=daed procd=unreported", after)

    def test_separates_new_logs_from_history_and_redacts_both(self):
        baseline = (self.root / "tmp/logs").read_text()
        history = json.loads(baseline)["logs"]
        self.router.write("/tmp/logs-after", json.dumps({"logs": history + '\ntime="17:36:30" level=error msg="dial timeout token=new-private-token https://secret.example/private"'}))
        result = self.run_check()
        history, changes = result.stdout.split("[Log changes during probes;")
        self.assertIn("Bind to LAN: eth0", history)
        self.assertNotIn("Bind to LAN: eth0", changes)
        self.assertIn("new_log_lines=1", changes)
        self.assertIn("17:36:30", changes)
        for secret in ("private-secret", "private-token", "new-private-token", "secret.example"):
            self.assertNotIn(secret, result.stdout + result.stderr)

    def test_tail_truncation_preserves_overlap_but_rotation_is_not_called_new(self):
        for after_logs, expected in (
            ('time="14:00:02" level=info msg="Ready"\ntime="17:36:30" level=error msg="dial timeout"', "new_log_lines=1"),
            ('time="17:36:30" level=error msg="dial timeout"', "log_continuity=unknown"),
        ):
            with self.subTest(expected=expected):
                (self.root / "tmp/probes-completed").unlink(missing_ok=True)
                self.router.write("/tmp/logs", json.dumps({"logs": 'time="14:00:01" level=info msg="old history"\ntime="14:00:02" level=info msg="Ready"'}))
                self.router.write("/tmp/logs-after", json.dumps({"logs": after_logs}))
                result = self.run_check()
                changes = result.stdout.split("[Log changes during probes;")[1]
                self.assertIn(expected, changes)
                self.assertNotIn("14:00:02", changes)
                if "unknown" in expected:
                    self.assertNotIn("new_log_lines=", changes)

    def test_missing_log_baseline_cannot_classify_later_logs_as_new(self):
        self.router.write("/tmp/logs", '{"logs":""}')
        self.router.write("/tmp/logs-after", '{"logs":"level=error msg=timeout"}')
        result = self.run_check()
        self.assertIn("log_continuity=unknown", result.stdout)
        self.assertNotIn("new_log_lines=", result.stdout)

    def test_without_timeout_skips_firewall_and_dns_queries(self):
        (self.root / "usr/sbin/timeout").unlink()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("marker inspection skipped", result.stdout)
        self.assertIn("DNS probe skipped", result.stdout)
        for calls in ("nft-calls", "iptables-calls", "dns-calls"):
            self.assertFalse((self.root / "tmp" / calls).exists())
