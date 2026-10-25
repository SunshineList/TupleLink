"""Check real local links and supported deployment entry points after cleanup."""
from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]


class RepositoryReferencesTest(unittest.TestCase):
    def test_maintained_markdown_links_resolve(self):
        documents = [ROOT / name for name in ("README.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/build.md", "docs/getting-started.md")]
        for path in documents:
            for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
                url = urlsplit(target)
                if url.scheme or url.netloc or not url.path:
                    continue
                with self.subTest(document=path.name, target=target):
                    self.assertTrue((path.parent / unquote(url.path)).is_file())

    def test_changelog_covers_every_released_version(self):
        """The changelog is the entry point; losing a version silently is the
        failure mode worth guarding, so assert coverage against the source."""
        versions = re.findall(r"^## (0\.6\.\d+)(?: |$)", (ROOT / "openwrt/README.md").read_text(encoding="utf-8"), re.M)
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertGreater(len(versions), 20, "expected the router README to keep its release sections")
        missing = [version for version in versions if version not in changelog]
        self.assertEqual(missing, [], "CHANGELOG.md is missing these releases")

    def test_systemd_and_desktop_binary_entry_remain_compatible(self):
        self.assertIn("ExecStart=/usr/bin/daed run -c /etc/daed/", (ROOT / "install/daed.service").read_text())
        self.assertIn('Exec=xdg-open "http://127.0.0.1:2023"', (ROOT / "install/daed.desktop").read_text())
        self.assertTrue((ROOT / "install/icons/256x256.png").is_file())
