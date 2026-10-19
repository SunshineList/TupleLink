"""Run recovery triggers and installer exclusion in real BusyBox/UCI."""
import subprocess
import unittest

import test_router


class ServiceRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_router.RouterTests.setUpClass()

    def setUp(self):
        self.router = test_router.RouterTests()
        self.router.setUp()
        self.addCleanup(self.router.tearDown)
        self.router.write('/installer/daed.init', (test_router.OPENWRT / 'files/daed.init').read_bytes())
        self.router.write('/etc/config/daed', (test_router.OPENWRT / 'files/daed.config').read_bytes())

    def shell(self, code):
        return self.router.run_router('/bin/sh', '-c', '. /lib/functions.sh; . /installer/daed.init; ' + code)

    def test_wan_reconnection_and_custom_lan_register_expected_triggers(self):
        self.assertEqual(self.router.run_router('uci', 'set', 'daed.main.lan_network=home').returncode, 0)
        result = self.shell('''procd_add_reload_trigger() { echo "config $*"; }
procd_add_interface_trigger() { echo "$*"; }
service_triggers''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), [
            'config daed',
            'interface.* home /etc/init.d/daed reload',
            'interface.up wan /etc/init.d/daed reload',
            'interface.up wan6 /etc/init.d/daed reload',
        ])

    def test_reload_uses_current_service_and_propagates_failure(self):
        for code in (0, 7):
            result = self.shell('restart() { echo restart >> /tmp/reloads; return ' + str(code) + '; }; reload_service')
            self.assertEqual(result.returncode, code, result.stderr)
        self.assertEqual((self.router.root / 'tmp/reloads').read_text().splitlines(), ['restart', 'restart'])

    def test_custom_uplink_names_are_used_for_recovery(self):
        for option, value in (('wan_network', 'uplink'), ('wan6_network', 'uplink6')):
            self.assertEqual(self.router.run_router('uci', 'set', 'daed.main.' + option + '=' + value).returncode, 0)
        result = self.shell('''procd_add_reload_trigger() { :; }
procd_add_interface_trigger() { echo "$*"; }
service_triggers''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[1:], [
            'interface.up uplink /etc/init.d/daed reload',
            'interface.up uplink6 /etc/init.d/daed reload',
        ])

    def test_network_reload_waits_until_installer_releases_lock(self):
        holder = subprocess.Popen(
            ['chroot', str(self.router.root), '/bin/sh', '-c',
             'mkdir -p /var/lock; exec 9>/var/lock/daed-install.lock; flock -n 9 || exit 1; echo ready; read -r wait'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'ready')
            result = self.shell('restart() { touch /tmp/unexpected-restart; }; reload_service')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((self.router.root / 'tmp/unexpected-restart').exists())
        finally:
            holder.communicate(input='release\n', timeout=3)
        result = self.shell('restart() { touch /tmp/recovered; }; reload_service')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.router.root / 'tmp/recovered').exists())
