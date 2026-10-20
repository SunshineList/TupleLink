#!/usr/bin/env python3
"""Exercise a foreign runtime's real SQLite/API with QEMU; no eBPF is loaded."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--cpu", choices=("armv7", "mips", "mipsle"), required=True)
    parser.add_argument("--qemu-dir", type=Path, default=Path("/usr/bin"))
    args = parser.parse_args()
    emulator = args.qemu_dir / ("qemu-" + {"armv7": "arm", "mips": "mips", "mipsle": "mipsel"}[args.cpu] + "-static")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="nailink-arch-smoke-") as temporary:
        root = Path(temporary)
        token = None

        def request(query):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            req = urllib.request.Request(f"http://127.0.0.1:{port}/graphql", data=json.dumps({"query": query}).encode(), headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                result = json.load(response)
            if result.get("errors"):
                raise RuntimeError(result["errors"])
            return result["data"]

        def start(output):
            process = subprocess.Popen([str(emulator), str(args.binary.resolve()), "run", "--api-only", "--config", str(root / "state"),
                                        "--listen", f"127.0.0.1:{port}"], stdout=output, stderr=output)
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("foreign runtime exited before API readiness; see " + str(root / "runtime.log"))
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=.5) as response:
                        if b"<html" in response.read(): return process
                except (OSError, urllib.error.URLError): pass
                time.sleep(.1)
            process.terminate(); process.wait(timeout=10)
            raise RuntimeError("foreign API readiness timed out")

        with (root / "runtime.log").open("w+") as output:
            process = None
            try:
                process = start(output)
                token = request('mutation{createUser(username:"archtest",password:"Architecture1234")}')["createUser"]
                created = request('mutation{createGroup(name:"PersistedArchitectureTest",policy:fixed,policyParams:[]){id name}}')["createGroup"]
                request('mutation{setJsonStorage(paths:["archSmoke"],values:["preserved"])}')
                process.terminate(); process.wait(timeout=10); process = None
                process = start(output)
                groups = request("query{groups{id name}}")['groups']
                assert created in groups, "SQLite data was lost after restart"
                print(f"PASS {args.cpu}: real API, SQLite migrations/write/read, authenticated mutation and restart persistence; API-only", flush=True)
            except BaseException:
                output.flush()
                print((root / "runtime.log").read_text(errors="replace")[-2500:])
                raise
            finally:
                if process is not None and process.poll() is None:
                    process.terminate(); process.wait(timeout=10)


if __name__ == "__main__":
    main()
