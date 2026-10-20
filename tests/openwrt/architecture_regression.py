#!/usr/bin/env python3
"""Run DNS and ordered interface recovery regressions under foreign userspace.

This does not load eBPF or validate transparent interception on a target kernel.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cpu', choices=('armv7', 'mips', 'mipsle'), required=True)
    parser.add_argument('--wing', type=Path, required=True)
    parser.add_argument('--qemu-dir', type=Path, default=Path('/usr/bin'))
    args = parser.parse_args()
    goarch, emulator = {'armv7': ('arm', 'arm'), 'mips': ('mips', 'mips'), 'mipsle': ('mipsle', 'mipsel')}[args.cpu]
    env = dict(os.environ, GOOS='linux', GOARCH=goarch, CGO_ENABLED='0', GOARM='7,softfloat', GOMIPS='softfloat')
    regex = '^Test(RouterDNS|RouterConnection|RouteDial|DnsController|DnsCache|DnsSingleflight|DNS|DnsPreference|DnsFallback|DnsForwarder|DnsListener|DnsDialer|DnsConnPool|ProxyHealth|DialFamily|RouteDialFamily|ControlPlane.*(Drain|Close|Shutdown)|Udp.*(Recovery|Instability))'
    with tempfile.TemporaryDirectory(prefix='nailink-architecture-regression-') as temporary:
        for package, selected in (('./component', '^TestRouterInterface'), ('./component/dns', '.'), ('./control', regex)):
            binary = Path(temporary) / 'regression'
            subprocess.run(['go', 'test', '-c', '-o', str(binary), package], cwd=args.wing / 'dae-core', env=env, check=True)
            subprocess.run([str(args.qemu_dir / ('qemu-' + emulator + '-static')), str(binary), '-test.run', selected, '-test.v', '-test.timeout', '120s'], check=True)


if __name__ == '__main__':
    main()
