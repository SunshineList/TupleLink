#!/usr/bin/env python3
"""Build a versioned static runtime and helpers for one reviewed CPU profile."""
import argparse
import json
import gzip
import hashlib
import os
from pathlib import Path
import re
import subprocess

from build import ARCHITECTURES, HERE, prepare_sdk, verify_elf


# The router ships the panel inside the package, so a dependency that quietly
# pulls in a few megabytes is a release problem, not a local build annoyance.
# The budget is what the bundle actually weighs after the Makefile's gzip rule,
# measured on the 0.6.31 tree at 2.44 MiB. It is a ceiling with headroom, not a
# target: it exists to catch a regression of the monaco/Shiki kind, where one
# import re-adds several megabytes of grammar files nobody requests.
WEB_BUNDLE_BUDGET = 4 * 1024 * 1024
GZIP_THRESHOLD = 4096
GZIP_SKIP_SUFFIXES = (".gz", ".woff", ".woff2")


def bundled_size(web):
    """Estimate the shipped size the same way wing/Makefile builds it."""
    total = 0
    for path in web.rglob("*"):
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size > GZIP_THRESHOLD and not path.name.endswith(GZIP_SKIP_SUFFIXES):
            # The Makefile keeps the compressed copy only when it is smaller.
            total += min(size, len(gzip.compress(path.read_bytes(), 9)))
        else:
            total += size
    return total


def verify_web_budget(web, budget=WEB_BUNDLE_BUDGET):
    """Fail the build when the panel outgrows the budgeted package size."""
    size = bundled_size(web)
    if size > budget:
        raise ValueError(
            "Bundled frontend is " + str(size) + " bytes, over the " + str(budget)
            + "-byte budget; check for a dependency that adds unreachable chunks")
    return size


def verify_web_bundle(web, bundled):
    """Reject make/copy failures that otherwise silently embed a stale UI."""
    expected = {p.relative_to(web).as_posix(): p for p in web.rglob("*") if p.is_file()}
    used = set()
    for name, source in expected.items():
        target = bundled / name
        if target.is_file():
            content = target.read_bytes()
        elif not name.endswith(".gz") and target.with_name(target.name + ".gz").is_file():
            target = target.with_name(target.name + ".gz")
            content = gzip.decompress(target.read_bytes())
        else:
            raise ValueError("Bundled frontend missing: " + name)
        if hashlib.sha256(content).digest() != hashlib.sha256(source.read_bytes()).digest():
            raise ValueError("Bundled frontend differs from current build: " + name)
        used.add(target.relative_to(bundled).as_posix())
    actual = {p.relative_to(bundled).as_posix() for p in bundled.rglob("*") if p.is_file()}
    if actual != used or "index.html" not in expected:
        raise ValueError("Unexpected or incomplete bundled frontend; refuse stale assets")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpu", choices=ARCHITECTURES, required=True)
    parser.add_argument("--wing", type=Path, required=True)
    parser.add_argument("--web", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("version must be X.Y.Z")
    wing, web = args.wing.resolve(strict=True), args.web.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    profile = ARCHITECTURES[args.cpu]
    env = os.environ.copy()
    # Avoid carrying an incompatible ABI selection from an earlier build.
    for key in ("GOARM", "GOARM64", "GOAMD64", "GOMIPS", "GOMIPS64", "CC", "CGO_CFLAGS", "CGO_LDFLAGS", "GO_LDFLAGS"):
        env.pop(key, None)
    env.update(GOOS="linux", GOARCH=profile["goarch"], CGO_ENABLED="0")
    env.update(profile["env"])
    if profile.get("cgo"):
        matrix = json.loads((HERE / "sdk-matrix.json").read_text())
        sdk = prepare_sdk(next(row for row in matrix if row["name"] == "ipk-" + args.cpu), args.work)
        compilers = list(sdk.glob("staging_dir/toolchain-*/bin/*-openwrt-linux-musl-gcc"))
        if len(compilers) != 1:
            raise ValueError("Pinned SDK must contain one musl cross compiler")
        # MIPS uses the existing CGO SQLite driver. CGO=0 compiles a stub which
        # exits at database initialization; external static linking is required.
        env.update(CGO_ENABLED="1", CC=str(compilers[0]), STAGING_DIR=str(sdk / "staging_dir"))
        # The pinned SQLite amalgamation requests the legacy *64 POSIX names;
        # musl exposes these 64-bit aliases only with this feature macro.
        env["CGO_CFLAGS"] = "-O2 -D_LARGEFILE64_SOURCE"
        env["PATH"] = str(compilers[0].parent) + os.pathsep + env.get("PATH", "")
        env["GO_LDFLAGS"] = "-linkmode=external -extldflags=-static"
    subprocess.run(["python3", str(HERE / "prepare-wing.py"), str(wing)], check=True)
    subprocess.run(["make", "APPNAME=daed", "VERSION=" + args.version, "WEB_DIST=" + str(web),
                    "OUTPUT=" + str(output / "daed"), "bundle"], cwd=wing, env=env, check=True)
    verify_web_bundle(web, wing / "webrender/web")
    # Checked after the bundle so a stale tree fails with the clearer message.
    size = verify_web_budget(web)
    print("bundled frontend: " + str(size) + " bytes")
    # The helpers do not use SQLite and remain pure Go on every architecture.
    env["CGO_ENABLED"] = "0"
    for name in ("btf-probe", "luci-proxy"):
        subprocess.run(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(output / name),
                        str(HERE / (name + ".go"))], cwd=wing, env=env, check=True)
    for name in ("daed", "btf-probe", "luci-proxy"):
        verify_elf(output / name, args.cpu)


if __name__ == "__main__":
    main()
