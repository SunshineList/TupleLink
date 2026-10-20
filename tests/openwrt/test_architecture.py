"""Architecture selection and ABI guards, with real ash/UCI and synthetic ELF."""
import importlib.util
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import test_router

SPEC = importlib.util.spec_from_file_location("architecture_build", test_router.OPENWRT / "build.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ELFArchitectureTests(unittest.TestCase):
    def test_sdk_is_verified_before_atomic_extraction_and_can_be_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "fixture.archive"
            archive.write_bytes(b"SDK fixture bytes")
            target = {"name": "fixture-sdk", "url": archive.as_uri(), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
            def extract(*args, **kwargs):
                Path(args[-1], "reviewed-marker").write_text("complete")
            with patch.object(BUILD, "run", side_effect=extract) as run:
                sdk = BUILD.prepare_sdk(target, root / "work")
                self.assertEqual((sdk / "reviewed-marker").read_text(), "complete")
                self.assertEqual(BUILD.prepare_sdk(target, root / "work"), sdk)
                self.assertEqual(run.call_count, 1)
            self.assertFalse(list((root / "work").glob(".sdk-unpack-*")))
            target["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "checksum"):
                BUILD.prepare_sdk(target, root / "rejected")
            self.assertFalse((root / "rejected/fixture-sdk").exists())

    def elf(self, cpu, dynamic=False):
        cls, data, machine = BUILD.ARCHITECTURES[cpu]["elf"]
        order = "<" if data == 1 else ">"
        raw = bytearray(120)
        raw[:7] = b"\x7fELF" + bytes((cls, data, 1))
        struct.pack_into(order + "H", raw, 18, machine)
        struct.pack_into(order + ("Q" if cls == 2 else "I"), raw, 32 if cls == 2 else 28, 64)
        struct.pack_into(order + "HH", raw, 54 if cls == 2 else 42, 56 if cls == 2 else 32, 1)
        struct.pack_into(order + "I", raw, 64, 3 if dynamic else 1)
        return raw

    def test_static_bitness_machine_and_byte_order_are_checked(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "runtime"
            for cpu in BUILD.ARCHITECTURES:
                with self.subTest(cpu=cpu):
                    binary.write_bytes(self.elf(cpu))
                    BUILD.verify_elf(binary, cpu)
                    for other in BUILD.ARCHITECTURES:
                        if other != cpu:
                            with self.assertRaises(ValueError): BUILD.verify_elf(binary, other)
                    binary.write_bytes(self.elf(cpu, dynamic=True))
                    with self.assertRaisesRegex(ValueError, "static"):
                        BUILD.verify_elf(binary, cpu)


class RouterArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_router.RouterTests.setUpClass()

    def test_armv7_and_mips_byte_orders_select_matching_package_and_probe(self):
        for fmt in ("ipk", "apk"):
            for machine, arch, cpu in (("armv7l", "arm_cortex-a7_neon-vfpv4", "armv7"),
                                       ("mips", "mips_24kc", "mips"), ("mips", "mipsel_24kc", "mipsle")):
                with self.subTest(format=fmt, machine=machine, arch=arch):
                    case = test_router.RouterTests(); case.setUp()
                    try:
                        if fmt == "apk": case.use_apk(machine=machine, architecture=arch)
                        else:
                            case.write("/tmp/machine", machine + "\n")
                            case.write("/tmp/arch", arch + "\n")
                            case.assets(fmt, arch)
                        result = case.install("--dry-run")
                        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                        self.assertIn(machine + " / " + fmt + " / " + arch, result.stdout)
                        self.assertIn("32 位", result.stdout)
                        self.assertFalse((case.root / "etc/daed/wing.db").exists())
                        probe = case.root / "assets" / ("btf-probe-" + cpu)
                        probe.unlink()
                        failure = case.install("--dry-run")
                        self.assertNotEqual(failure.returncode, 0)
                        self.assertNotIn("update", (case.root / "tmp/pm-calls").read_text())
                    finally: case.tearDown()

    def test_other_architectures_are_refused_before_network_or_package_changes(self):
        for machine in ("armv5tel", "armv6l", "mips64", "riscv64", "i686"):
            with self.subTest(machine=machine):
                case = test_router.RouterTests(); case.setUp()
                try:
                    case.write("/tmp/machine", machine + "\n")
                    case.write("/tmp/pm-calls", "")
                    result = case.install("--dry-run")
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Unsupported CPU", result.stderr)
                    self.assertEqual((case.root / "tmp/pm-calls").read_text(), "")
                finally: case.tearDown()

    def test_kernel_probe_rejection_preserves_existing_service_and_database(self):
        for fmt in ('ipk', 'apk'):
            case = test_router.RouterTests(); case.setUp()
            try:
                if fmt == 'apk': case.use_apk(machine='mips', architecture='mipsel_24kc')
                else:
                    case.write('/tmp/machine', 'armv7l\n')
                    case.write('/tmp/arch', 'arm_cortex-a7_neon-vfpv4\n')
                    case.assets(fmt, 'arm_cortex-a7_neon-vfpv4')
                case.managed()
                case.write('/etc/daed/wing.db', 'preserved-database')
                case.write('/tmp/kernel-bad', '')
                case.write('/tmp/pm-calls', '')
                result = case.install('--dry-run')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('kernel callback unsupported', result.stdout + result.stderr)
                self.assertIn('--kernel', (case.root / 'tmp/kernel-probes').read_text())
                self.assertEqual((case.root / 'etc/daed/wing.db').read_text(), 'preserved-database')
                self.assertTrue((case.root / 'tmp/daemon-running').exists())
                self.assertNotIn('update', (case.root / 'tmp/pm-calls').read_text())
                check = case.run_router('/bin/sh', '/fixtures/check')
                report = json.loads(check.stdout)
                statuses = {item['name']: item['status'] for item in report['checks']}
                self.assertEqual(statuses['btf'], 'ok')
                self.assertEqual(statuses['kernel_datapath'], 'error')
            finally: case.tearDown()
