import gzip
import importlib.util
import os
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


class WebBudgetTests(unittest.TestCase):
    """The panel ships inside the package, so its size needs a ceiling."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.web = Path(self.directory.name) / "dist"
        self.web.mkdir()

    def test_small_tree_passes_and_reports_its_size(self):
        (self.web / "index.html").write_bytes(b"<html></html>")
        size = runtime.verify_web_budget(self.web)
        self.assertEqual(size, len(b"<html></html>"))

    def test_repetitive_payload_is_measured_after_compression(self):
        # A megabyte of one repeated byte compresses to almost nothing, and the
        # Makefile would ship the .gz copy, so the budget must not reject it.
        (self.web / "bundle.js").write_bytes(b"a" * (1024 * 1024))
        self.assertLess(runtime.verify_web_budget(self.web), 64 * 1024)

    def test_small_files_are_not_compressed_like_the_makefile(self):
        # wing/Makefile only gzips files above 4 KiB; anything smaller is shipped
        # as-is, so its raw size has to be counted.
        payload = b"b" * 100
        (self.web / "tiny.js").write_bytes(payload)
        self.assertEqual(runtime.verify_web_budget(self.web), len(payload))

    def test_woff2_is_never_recompressed(self):
        payload = b"c" * (1024 * 1024)
        (self.web / "font.woff2").write_bytes(payload)
        self.assertEqual(runtime.verify_web_budget(self.web), len(payload))

    def test_incompressible_tree_over_budget_is_rejected(self):
        # Random bytes do not compress, so this is genuinely 5 MiB of package.
        (self.web / "huge.bin").write_bytes(os.urandom(5 * 1024 * 1024))
        with self.assertRaisesRegex(ValueError, "over the"):
            runtime.verify_web_budget(self.web)

    def test_budget_is_explicit_so_the_message_is_actionable(self):
        (self.web / "big.bin").write_bytes(os.urandom(8192))
        with self.assertRaisesRegex(ValueError, "over the 4096-byte budget"):
            runtime.verify_web_budget(self.web, budget=4096)


if __name__ == "__main__":
    unittest.main()
