"""Real procd one-shot jobs in disposable PID/user/mount/network namespaces."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time
import unittest

import test_router


class NativeMaintenanceTests(unittest.TestCase):
    def test_procd_runs_distinct_jobs_without_rpc_lifetime_or_respawn(self):
        binary = os.environ.get("DAED_TEST_LUCI_PROXY")
        if not binary:
            self.skipTest("Set DAED_TEST_LUCI_PROXY to the compiled gateway")
        test_router.RouterTests.setUpClass()
        probe = subprocess.run(["unshare", "--user", "--map-root-user", "--pid", "--fork", "true"], capture_output=True)
        if probe.returncode:
            self.skipTest("Host does not allow isolated user/PID namespaces")
        case = test_router.RouterTests()
        case.setUp()
        processes = []
        try:
            (case.root / "bin/ubus").unlink()
            shutil.copy2(case.base / "bin/ubus", case.root / "bin/ubus", follow_symlinks=True)
            case.write("/usr/libexec/daed/luci-proxy", Path(binary).read_bytes(), True)
            case.write("/usr/libexec/daed/nailink-maintenance", (test_router.OPENWRT / "files/maintenance.init").read_bytes(), True)
            (case.root / "dev/null").unlink()
            for name, minor in (("null", 3), ("urandom", 9)):
                os.mknod(case.root / "dev" / name, stat.S_IFCHR | 0o666, os.makedev(1, minor))
            (case.root / "var/run/ubus").mkdir(parents=True, exist_ok=True)
            (case.root / "var/lock").mkdir(parents=True, exist_ok=True)
            processes.append(subprocess.Popen(["chroot", str(case.root), "/sbin/ubusd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            for _ in range(60):
                if (case.root / "var/run/ubus/ubus.sock").exists(): break
                time.sleep(0.05)
            # The shell is namespace PID 1, so procd runs only its service
            # manager path. No real router, host network, init or cgroups change.
            processes.append(subprocess.Popen([
                "unshare", "--user", "--map-root-user", "--mount", "--net", "--ipc", "--uts", "--pid", "--fork", "--kill-child=SIGKILL",
                "--mount-proc=" + str(case.root / "proc"), "chroot", str(case.root), "/bin/sh", "-c", "/sbin/procd -S & wait",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            for _ in range(100):
                response = case.run_router("/bin/ubus", "list", "service")
                if "service" in response.stdout: break
                if processes[-1].poll() is not None: self.fail("isolated procd exited before registering its service API")
                time.sleep(0.05)
            else: self.fail("procd service API unavailable")
            directory = case.root / "var/run/daed-maintenance"
            directory.mkdir(mode=0o700)
            for index in range(2):
                identifier = f"{index+1:024x}"
                job = {"id": identifier, "action": "update", "state": "queued", "phase": "queued", "target": "invalid", "started": int(time.time()), "updated": int(time.time())}
                state = directory / "job.json"
                state.write_text(json.dumps(job))
                state.chmod(0o600)
                result = case.run_router("/usr/libexec/daed/nailink-maintenance", "start", identifier)
                self.assertEqual(result.returncode, 0, result.stderr)
                for _ in range(100):
                    try: final = json.loads(state.read_text())
                    except (OSError, ValueError): final = {}
                    if final.get("state") == "error": break
                    time.sleep(0.05)
                else: self.fail("procd did not execute the queued worker")
                self.assertEqual(final["id"], identifier)
                self.assertEqual(final["code"], "invalid_release")
            self.assertFalse((case.root / "tmp/daemon-running").exists(), "worker changed the proxy service")
        finally:
            for process in reversed(processes): process.kill()
            for process in reversed(processes): process.wait(timeout=5)
            case.tearDown()
