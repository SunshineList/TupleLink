"""Diagnostic downloader tests with real BusyBox/UCI/jsonfilter and synthetic HTTP fixtures."""
import base64
import json
from pathlib import Path
import unittest

import test_router as router_fixture


class SubscriptionCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        router_fixture.RouterTests.setUpClass()

    def setUp(self):
        self.router = router_fixture.RouterTests()
        self.router.setUp()
        self.root = self.router.root
        project = Path(__file__).resolve().parents[2]
        self.router.write('/fixtures/subscription-check', (project / 'openwrt/subscription-check.sh').read_bytes(), True)
        self.router.write('/etc/config/passwall', """config global
 option localhost_proxy '1'
config subscribe_list 'sub_test'
 option url 'https://example.invalid/private-secret-token?sub=3'
 option user_agent 'passwall'
""")
        self.router.script('/bin/lua', """case "$2" in
 *GLOBAL_SOCKS_server*) cat /tmp/test-socks 2>/dev/null ;;
 *) echo '26.10.1' ;;
esac""")
        self.router.write('/tmp/test-socks', '127.0.0.1:1070')
        self.router.write('/tmp/auth-body', json.dumps({'code': 'AUTH_FAIL', 'error': 'IP denied private-secret-token'}))
        self.router.write('/tmp/nodes-body', base64.b64encode(b'vless://private-node-secret@192.0.2.1:443#fixture\n'))
        self.router.script('/bin/curl', """mode=system
out=
ua=
while [ "$#" -gt 0 ]; do
 case "$1" in
  --output) out=$2; shift ;;
  --user-agent) ua=$2; shift ;;
  --proxy) mode=socks; shift ;;
  --url) printf '%s' "$2" > /tmp/received-url; shift ;;
 esac
 shift
done
echo "$mode" >> /tmp/probe-modes
printf '%s' "$ua" > /tmp/received-ua
if [ -e /tmp/curl-fail ]; then
 echo 'error https://example.invalid/private-secret-token' >&2
 echo 000
 exit 7
fi
if [ -e /tmp/all-success ] || [ "$mode" = socks ]; then
 cp /tmp/nodes-body "$out"
 printf 200
else
 cp /tmp/auth-body "$out"
 printf 403
fi""")

    def tearDown(self):
        self.router.tearDown()

    def run_check(self, *args):
        return self.router.run_router('/bin/sh', '/fixtures/subscription-check', *args)

    def assert_private(self, output):
        for secret in ('private-secret-token', 'private-node-secret', 'IP denied', 'example.invalid'):
            self.assertNotIn(secret, output)
        self.assertEqual(list((self.root / 'tmp').glob('daed-subcheck.*')), [])

    def test_auth_failure_and_socks_success_preserve_configuration_and_hide_secrets(self):
        before = (self.root / 'etc/config/passwall').read_bytes()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('profile=system_daed http=403 curl_exit=0 result=AUTH_FAIL', result.stdout)
        self.assertIn('profile=system_passwall http=403 curl_exit=0 result=AUTH_FAIL', result.stdout)
        self.assertIn('profile=passwall_socks http=200 curl_exit=0 format=base64 node_links=1', result.stdout)
        self.assertEqual((self.root / 'tmp/received-ua').read_text(), 'passwall/26.10.1')
        self.assertEqual(before, (self.root / 'etc/config/passwall').read_bytes())
        self.assert_private(result.stdout + result.stderr)

    def test_url_is_passed_as_one_literal_argument_without_shell_evaluation(self):
        link = 'https://example.invalid/?token=private-secret-token&literal=$(touch /tmp/evaluated)`touch /tmp/evaluated2`'
        self.router.run_router('/sbin/uci', 'set', 'passwall.sub_test.url=' + link)
        self.router.run_router('/sbin/uci', 'commit', 'passwall')
        result = self.run_check('sub_test')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual((self.root / 'tmp/received-url').read_text(), link)
        self.assertFalse((self.root / 'tmp/evaluated').exists())
        self.assertFalse((self.root / 'tmp/evaluated2').exists())
        self.assert_private(result.stdout + result.stderr)

    def test_external_or_credentialed_proxy_is_not_used_and_curl_errors_are_private(self):
        self.router.write('/tmp/test-socks', 'user:private-secret-token@proxy.example:1080')
        self.router.write('/tmp/curl-fail', '')
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('socks_available=no', result.stdout)
        self.assertEqual((self.root / 'tmp/probe-modes').read_text().splitlines(), ['system', 'system'])
        self.assertIn('http=000 curl_exit=7', result.stdout)
        self.assert_private(result.stdout + result.stderr)

    def test_html_and_yaml_200_are_not_reported_as_node_download_success(self):
        self.router.write('/tmp/all-success', '')
        for body, expected in [(b'<html>private-secret-token</html>', 'format=html'), (b'proxies:\n - name: secret', 'format=clash_yaml')]:
            with self.subTest(expected=expected):
                self.router.write('/tmp/nodes-body', body)
                result = self.run_check()
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn(expected, result.stdout)
                self.assertNotIn('node_links=', result.stdout)
                self.assert_private(result.stdout + result.stderr)

    def test_unknown_or_malicious_section_is_rejected_before_download(self):
        for section in ['unknown', 'sub_test;touch /tmp/evaluated']:
            result = self.run_check(section)
            self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'tmp/evaluated').exists())
        self.assertFalse((self.root / 'tmp/probe-modes').exists())

    def test_wrapped_urlsafe_base64_and_sip008_do_not_need_extra_decoder_packages(self):
        self.router.write('/tmp/all-success', '')
        node = 'vless://private-node-secret@192.0.2.1:443#测试节点\n'.encode()
        payloads = [
            (base64.encodebytes(node), 'format=base64 node_links=1'),
            (base64.urlsafe_b64encode(node).rstrip(b'='), 'format=base64 node_links=1'),
            (json.dumps({'version': 1, 'servers': [{'server': '192.0.2.1', 'password': 'private-node-secret'}]}).encode(), 'format=sip008 entries=1'),
        ]
        for body, expected in payloads:
            with self.subTest(expected=expected):
                self.router.write('/tmp/nodes-body', body)
                result = self.run_check()
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn(expected, result.stdout)
                self.assert_private(result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
