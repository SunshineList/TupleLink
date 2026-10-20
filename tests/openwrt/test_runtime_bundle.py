import gzip
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[2] / "openwrt"
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("router_runtime_builder", HERE / "runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeBundleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.web = Path(self.directory.name) / "dist"
        self.bundled = Path(self.directory.name) / "embedded"
        self.web.mkdir()
        self.bundled.mkdir()
        (self.web / "index.html").write_bytes(b"current-ui")
        (self.bundled / "index.html").write_bytes(b"current-ui")

    def test_current_plain_and_precompressed_files_match(self):
        (self.web / "app.js").write_bytes(b"current-code")
        (self.bundled / "app.js.gz").write_bytes(gzip.compress(b"current-code"))
        runtime.verify_web_bundle(self.web, self.bundled)

    def test_successful_make_cannot_hide_old_embedded_html_or_scripts(self):
        (self.bundled / "index.html").write_bytes(b"old-ui")
        with self.assertRaisesRegex(ValueError, "differs"):
            runtime.verify_web_bundle(self.web, self.bundled)

    def test_stale_extra_files_and_missing_files_are_rejected(self):
        (self.bundled / "old-entry.js.gz").write_bytes(gzip.compress(b"old"))
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            runtime.verify_web_bundle(self.web, self.bundled)
        (self.bundled / "old-entry.js.gz").unlink()
        (self.bundled / "index.html").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            runtime.verify_web_bundle(self.web, self.bundled)


if __name__ == "__main__":
    unittest.main()
