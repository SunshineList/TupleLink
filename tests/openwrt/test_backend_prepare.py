"""Verify reviewed backend patches without editing the pinned submodules."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("prepare_wing", ROOT / "openwrt/prepare-wing.py")
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)
SOURCES = (
    "graphql/service/subscription/mutation_utils.go",
    "graphql/service/node/latency_mutation_utils.go",
    "graphql/service/node/latency_cache.go",
    "graphql/mutation.go",
    "dae/runtime.go",
    "dae-core/component/outbound/dialer/register.go",
    "dae-core/common/subscription/subscription.go",
)


@unittest.skipUnless(all((ROOT / "wing" / name).is_file() for name in SOURCES), "pinned wing checkout required")
class BackendPrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for relative in SOURCES:
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text((ROOT / "wing" / relative).read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        (self.root / "dae-core/control").mkdir(parents=True)

    def test_runtime_patch_is_reproducible_and_idempotent(self):
        PREPARE.prepare(self.root)
        self.assertEqual((self.root / "dae/runtime.go").read_bytes(), (ROOT / "openwrt/wing/runtime.go").read_bytes())
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        PREPARE.prepare(self.root)
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        for name in ("dae/router_runtime_test.go", "dae-core/control/router_runtime_fixture.go"):
            self.assertTrue((self.root / name).read_text(encoding="utf-8").startswith("//go:build daed_runtime_test\n"))

    def test_unrecognized_runtime_source_is_preserved(self):
        path = self.root / "dae/runtime.go"
        path.write_bytes(path.read_bytes() + b"// local edit\n")
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "Unknown backend source"):
            PREPARE.prepare(self.root)
        self.assertEqual(path.read_bytes(), before)

    def test_unknown_fixture_edit_is_preserved(self):
        PREPARE.prepare(self.root)
        path = self.root / "dae-core/control/router_runtime_fixture.go"
        path.write_bytes(path.read_bytes() + b"// local edit\n")
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "Unknown runtime test fixture"):
            PREPARE.prepare(self.root)
        self.assertEqual(path.read_bytes(), before)

    def test_unknown_protocol_wrapper_edit_is_preserved(self):
        PREPARE.prepare(self.root)
        path = self.root / "dae-core/component/outbound/dialer/router_protocol_compat.go"
        path.write_bytes(path.read_bytes() + b"// local transport change\n")
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "Unknown protocol compatibility source"):
            PREPARE.prepare(self.root)
        self.assertEqual(path.read_bytes(), before)

    def test_previously_prepared_runtime_can_receive_reviewed_update(self):
        PREPARE.prepare(self.root)
        path = self.root / "dae/runtime.go"
        path.write_bytes(path.read_bytes() + b"// previous reviewed release\n")
        manifest = self.root / ".daed-openwrt-prepare.json"
        state = json.loads(manifest.read_text(encoding="utf-8"))
        state["dae/runtime.go"] = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest.write_text(json.dumps(state), encoding="utf-8")
        PREPARE.prepare(self.root)
        self.assertEqual(path.read_bytes(), (ROOT / "openwrt/wing/runtime.go").read_bytes())


if __name__ == "__main__":
    unittest.main()
