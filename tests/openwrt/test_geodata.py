"""Geodata lookup regression with real BusyBox and optional dae routing parser."""
import json
import os
from pathlib import Path
import unittest

import test_router as router_fixture


class GeodataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        router_fixture.RouterTests.setUpClass()

    def setUp(self):
        self.router = router_fixture.RouterTests()
        self.router.setUp()
        self.root = self.router.root
        executable = os.environ.get("DAED_TEST_GEODATA_PROBE")
        self.probe = bool(executable)
        if executable:
            self.router.write("/fixtures/geodata-probe", Path(executable).read_bytes(), True)
            result = self.router.run_router("/fixtures/geodata-probe", "--fixtures", "/usr/share/v2ray")
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            for name in ("geosite.dat", "geoip.dat"):
                self.router.write("/usr/share/v2ray/" + name, "diagnostic fixture only")

    def tearDown(self):
        self.router.tearDown()

    def link_assets(self):
        for name in ("geosite.dat", "geoip.dat"):
            link = self.root / "usr/share/daed" / name
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to("../v2ray/" + name)

    def probe_rules(self):
        if not self.probe:
            self.skipTest("Requires DAED_TEST_GEODATA_PROBE built from the pinned dae source")
        return self.router.run_router("/fixtures/geodata-probe")

    def check_rules(self):
        return {item["name"]: item for item in json.loads(self.router.check().stdout)["checks"] if item["name"] in ("geosite.dat", "geoip.dat")}

    def test_openwrt_data_without_bridge_reports_warning_and_reproduces_lookup_error(self):
        checks = self.check_rules()
        self.assertEqual(checks["geosite.dat"]["status"], "warning")
        self.assertIn("search-path link", checks["geosite.dat"]["message"])
        result = self.probe_rules()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("geosite.dat: file does not exist", result.stderr)

    def test_packaged_link_paths_resolve_and_expand_real_routing_rules(self):
        self.link_assets()
        self.assertTrue(all(item["status"] == "ok" for item in self.check_rules().values()))
        result = self.probe_rules()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["geosite.dat"], "/usr/share/daed/geosite.dat")
        self.assertEqual(data["geoip.dat"], "/usr/share/daed/geoip.dat")
        self.assertGreater(data["domain_rules"], 0)
        self.assertGreater(data["ip_rules"], 0)

    def test_custom_configuration_data_keeps_priority_without_mutation(self):
        self.link_assets()
        for name in ("geosite.dat", "geoip.dat"):
            self.router.write("/etc/daed/" + name, (self.root / "usr/share/v2ray" / name).read_bytes())
        before = {name: (self.root / "etc/daed" / name).read_bytes() for name in ("geosite.dat", "geoip.dat")}
        result = self.probe_rules()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["geosite.dat"], "/etc/daed/geosite.dat")
        self.assertEqual(data["geoip.dat"], "/etc/daed/geoip.dat")
        for name, value in before.items():
            self.assertEqual((self.root / "etc/daed" / name).read_bytes(), value)

    def test_missing_dependency_data_is_a_warning_before_install_and_parse_failure_after(self):
        self.link_assets()
        (self.root / "usr/share/v2ray/geosite.dat").unlink()
        self.assertEqual(self.check_rules()["geosite.dat"]["status"], "warning")
        self.assertTrue(json.loads(self.router.check().stdout)["compatible"])
        self.assertNotEqual(self.probe_rules().returncode, 0)

    def test_installer_does_not_start_with_unreadable_default_rules(self):
        self.router.write("/tmp/no-geodata", "")
        result = self.router.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Installed rule data is unavailable", result.stderr)
        self.assertFalse((self.root / "tmp/daemon-running").exists())
