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

    def test_issue_and_pull_templates_declare_valid_metadata(self):
        """Templates are inert YAML until GitHub parses them, so a bad front
        matter silently falls back to a blank issue form."""
        templates = sorted((ROOT / ".github/ISSUE_TEMPLATE").glob("*.yml"))
        self.assertGreaterEqual(len(templates), 3, "expected install, panel and feature templates")
        for path in templates:
            with self.subTest(template=path.name):
                front = path.read_text(encoding="utf-8").split("---\n")[1]
                for field in ("name", "about", "title", "labels"):
                    self.assertRegex(front, rf"(?m)^{field}:\s*\S", f"{path.name} is missing {field}")
        pull = (ROOT / ".github/pull_request_template.md").read_text(encoding="utf-8")
        self.assertIn("## 怎么验证的", pull, "the pull template must ask for evidence")

    def test_feedback_urls_point_at_the_active_issue_tracker(self):
        """The upstream tracker has issues disabled, and this fork's tracker is
        the one people can actually open a ticket on. Both start disabled, so
        the link must not point at a read-only repo."""
        for name in ("README.md", "CONTRIBUTING.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            for url in re.findall(r"\((https://github\.com/[^)]*/issues[^)]*)\)", text):
                with self.subTest(document=name, url=url):
                    self.assertNotIn("slobys/NaiLink", url, "the upstream tracker is read-only")

    def test_systemd_and_desktop_binary_entry_remain_compatible(self):
        self.assertIn("ExecStart=/usr/bin/daed run -c /etc/daed/", (ROOT / "install/daed.service").read_text())
        self.assertIn('Exec=xdg-open "http://127.0.0.1:2023"', (ROOT / "install/daed.desktop").read_text())
        self.assertTrue((ROOT / "install/icons/256x256.png").is_file())
