"""Guard the Docker build context against files the build reads from outside apps/."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "Dockerfile"
DOCKERIGNORE = ROOT / ".dockerignore"


def dockerignore_rules():
    rules = []
    for line in DOCKERIGNORE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rules.append((line.startswith("!"), line.lstrip("!").strip("/")))
    return rules


def ignored(relative: str, rules) -> bool:
    """Apply the last matching .dockerignore rule, the way Docker resolves them."""
    parts = relative.split("/")
    decision = False
    for negate, pattern in rules:
        pattern_parts = pattern.split("/")
        # Only the simple forms used in this repository: `docs`, `docs/**`, `*.md`.
        if pattern.endswith("/**"):
            prefix = pattern_parts[:-1]
            if parts[: len(prefix)] == prefix:
                decision = not negate
        elif "/" not in pattern:
            if any(part == pattern for part in parts) or Path(relative).match(pattern):
                decision = not negate
        elif parts[: len(pattern_parts)] == pattern_parts:
            decision = not negate
    return decision


class DockerContextTest(unittest.TestCase):
    def test_vite_config_imports_are_present_in_the_build_context(self):
        # apps/web/vite.config.ts imports docs/site/site.json for the panel
        # version. .dockerignore drops docs/, so a copy rule alone is not enough
        # and the web stage fails to resolve the import on every runner.
        config = (ROOT / "apps/web/vite.config.ts").read_text(encoding="utf-8")
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        rules = dockerignore_rules()
        external = [m.group(1) for m in re.finditer(r"""from\s+'(\.\./\.\./[^']+)'""", config)]
        self.assertTrue(external, "expected vite.config.ts to import a repository-level file")
        for specifier in external:
            relative = Path("apps/web", specifier).as_posix()
            resolved = (ROOT / relative).resolve()
            self.assertTrue(resolved.is_file(), f"{relative} does not exist")
            inside = resolved.relative_to(ROOT).as_posix()
            with self.subTest(file=inside):
                self.assertFalse(ignored(inside, rules), f".dockerignore excludes {inside}")
                self.assertIn(inside, dockerfile, f"Dockerfile never copies {inside}")


if __name__ == "__main__":
    unittest.main()
