#!/usr/bin/env python3
"""Test kernel preflight in a disposable full-system VM, never on the host.

Requires a checksum-verified kernel and cross-built kernel_probe_init.go/probe.
This is a callback/packet-access test, not a complete transparent-proxy test.
"""
import argparse
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time


def cpio_entry(stream, name, data=b'', mode=stat.S_IFREG | 0o644, major=0, minor=0):
    encoded = (name + '\0').encode()
    fields = [1, mode, 0, 0, 1, 0, len(data), 0, 0, major, minor, len(encoded), 0]
    header = b'070701' + ''.join(f'{value:08x}' for value in fields).encode()
    stream.write(header + encoded + b'\0' * (-(len(header) + len(encoded)) % 4))
    stream.write(data + b'\0' * (-len(data) % 4))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cpu', choices=('armv7', 'mips', 'mipsle', 'x86_64'), required=True)
    for name in ('kernel', 'init', 'probe', 'qemu', 'work'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--bios', type=Path)
    parser.add_argument('--firmware-dir', type=Path)
    parser.add_argument('--expect', choices=('success', 'failure'), required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    log = args.work.resolve() / ('kernel-probe-' + args.cpu + '.log')
    with tempfile.TemporaryDirectory(prefix='nailink-kernel-vm-', dir=args.work.resolve()) as temporary:
        root = Path(temporary)
        if args.cpu in ('mips', 'mipsle'):
            if os.geteuid() != 0: parser.error('MIPS disk fixture requires root for private device nodes')
            diskroot = root / 'root'
            (diskroot / 'dev').mkdir(parents=True)
            for name, source in (('init', args.init), ('probe', args.probe)):
                (diskroot / name).write_bytes(source.read_bytes()); (diskroot / name).chmod(0o755)
            for name, major, minor in (('console', 5, 1), ('null', 1, 3)):
                os.mknod(diskroot / 'dev' / name, stat.S_IFCHR | 0o600, os.makedev(major, minor))
            disk = root / 'root.ext4'
            subprocess.run(['mke2fs', '-q', '-F', '-t', 'ext4', '-d', str(diskroot), str(disk), '65536'], check=True, stdout=subprocess.DEVNULL)
            boot = ['-M', 'malta', '-cpu', '34Kf', '-m', '256', '-drive', f'file={disk},format=raw,if=ide,index=0',
                    '-append', 'console=ttyS0 root=/dev/sda rw init=/init panic=0']
        else:
            initrd = root / 'initrd.cpio'
            with initrd.open('wb') as stream:
                cpio_entry(stream, 'dev', mode=stat.S_IFDIR | 0o755)
                cpio_entry(stream, 'dev/console', mode=stat.S_IFCHR | 0o600, major=5, minor=1)
                cpio_entry(stream, 'dev/null', mode=stat.S_IFCHR | 0o666, major=1, minor=3)
                cpio_entry(stream, 'init', args.init.read_bytes(), stat.S_IFREG | 0o755)
                cpio_entry(stream, 'probe', args.probe.read_bytes(), stat.S_IFREG | 0o755)
                cpio_entry(stream, 'TRAILER!!!')
            boot = (['-M', 'virt', '-cpu', 'cortex-a15'] if args.cpu == 'armv7' else ['-M', 'pc', '-cpu', 'qemu64'])
            boot += ['-m', '512', '-initrd', str(initrd), '-append', ('console=ttyAMA0' if args.cpu == 'armv7' else 'console=ttyS0') + ' rdinit=/init panic=0']
        if args.bios: boot += ['-bios', str(args.bios.resolve())]
        if args.firmware_dir: boot += ['-L', str(args.firmware_dir.resolve())]
        command = [str(args.qemu.resolve()), *boot, '-smp', '1', '-nographic', '-nodefaults', '-serial', 'stdio', '-monitor', 'none', '-kernel', str(args.kernel.resolve())]
        with log.open('w') as output:
            process = subprocess.Popen(command, stdout=output, stderr=output, stdin=subprocess.DEVNULL)
            try:
                for _ in range(240):
                    text = log.read_text(errors='replace')
                    if 'NaiLinkKernelProbeResult=' in text: break
                    if process.poll() is not None: raise RuntimeError('VM exited before a probe result: ' + text[-2500:])
                    time.sleep(.25)
                else: raise RuntimeError('VM/probe timed out: ' + text[-2500:])
            finally:
                process.terminate(); process.wait(timeout=10)
        expected = 'NaiLinkKernelProbeResult=' + ('0' if args.expect == 'success' else '1')
        if expected not in text or (args.expect == 'failure' and 'kernel cannot load transparent-proxy requirement' not in text):
            raise RuntimeError('unexpected kernel result: ' + text[-3500:])
        print(f'PASS {args.cpu}: expected kernel preflight {args.expect}; complete log: {log}')


if __name__ == '__main__':
    main()
