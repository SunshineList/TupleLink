#!/usr/bin/env python3
"""Validate all SDK artifacts and produce the installer manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument(
        "--only",
        default="",
        help="Comma separated package architectures to require, e.g. x86_64. "
        "Empty means every architecture in sdk-matrix.json.",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("version must be X.Y.Z")
    rows = []
    seen = set()
    for record in sorted(args.directory.glob("*.tsv")):
        if record.name == "manifest.tsv":
            continue
        for line in record.read_text().splitlines():
            row = line.split("\t")
            if len(row) != 6 or row[5] != args.version:
                raise ValueError("Malformed or mismatched SDK record")
            fmt, arch, package, name, digest, _ = row
            if fmt not in ("ipk", "apk") or package not in ("daed-router", "luci-app-daed-router"):
                raise ValueError("Unexpected package record")
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", arch) or not re.fullmatch(r"[a-zA-Z0-9_-][a-zA-Z0-9._-]*", name):
                raise ValueError("Invalid package path or architecture")
            if not name.endswith("." + fmt):
                raise ValueError("Wrong package format")
            key = (fmt, arch, package)
            if key in seen:
                raise ValueError("Duplicate package record")
            seen.add(key)
            if hashlib.sha256((args.directory / name).read_bytes()).hexdigest() != digest:
                raise ValueError("Package checksum mismatch")
            rows.append(row)
    # 只编部分架构时（日常改面板），不能用全量清单去要求缺失的包，
    # 否则 assemble 会因为「找不到 aarch64 的包」而失败。
    wanted = {item.strip() for item in args.only.split(",") if item.strip()}
    for target in json.loads((HERE / "sdk-matrix.json").read_text()):
        expected = [(arch, "daed-router") for arch in target["architectures"]]
        expected.append(("all", "luci-app-daed-router"))
        for arch, package in expected:
            # luci-app 是架构无关的，任何一次构建都该有。
            if arch != "all" and wanted and arch not in wanted:
                continue
            if (target["format"], arch, package) not in seen:
                raise ValueError(f"Missing mandatory package: {target['format']}/{arch}/{package}")
    checker = args.directory / "daed-check"
    shutil.copyfile(HERE / "files" / "daed-check", checker)
    rows.append(["support", "all", "check", checker.name, hashlib.sha256(checker.read_bytes()).hexdigest(), args.version])
    # 按 cpu 去重：同一个 cpu 在 sdk-matrix 里有 ipk 和 apk 两条记录，
    # 而 btf-probe 是按 cpu 产出的唯一文件，遍历记录会让它出现两次。
    all_cpus = {target["cpu"] for target in json.loads((HERE / "sdk-matrix.json").read_text())}
    for cpu in sorted(all_cpus if not wanted else all_cpus & wanted):
        probe = args.directory / ("btf-probe-" + cpu)
        rows.append(["support", cpu, "btf-probe", probe.name, hashlib.sha256(probe.read_bytes()).hexdigest(), args.version])
    installer = (HERE / "install.sh").read_text(encoding="utf-8")
    installer, replacements = re.subn(r"^release=openwrt-v\d+\.\d+\.\d+$", "release=openwrt-v" + args.version, installer, flags=re.MULTILINE)
    if replacements != 1:
        raise ValueError("Installer release tag cannot be set unambiguously")
    (args.directory / "install.sh").write_text(installer, encoding="utf-8", newline="\n")
    (args.directory / "manifest.tsv").write_text("# daed-openwrt-manifest-v1\n" + "".join("\t".join(row) + "\n" for row in sorted(rows)))
    with open(args.directory / "SHA256SUMS", "w") as sums:
        for path in sorted(args.directory.iterdir()):
            if path.is_file() and path.name != "SHA256SUMS":
                sums.write(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")


if __name__ == "__main__":
    main()
