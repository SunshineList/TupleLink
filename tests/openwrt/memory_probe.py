"""Measure native API-only memory in disposable state; no eBPF or LAN takeover."""
from pathlib import Path
import argparse
import json
import re
import socket
import subprocess
import tempfile
import time
import urllib.request

parser = argparse.ArgumentParser(description='Measure native API-only RSS/virtual memory without loading eBPF or using router configuration.')
parser.add_argument('--binary', type=Path, required=True)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)

def sample(pid):
    status = Path(f'/proc/{pid}/status').read_text()
    rollup = Path(f'/proc/{pid}/smaps_rollup').read_text()
    values = {}
    for name in ('VmSize', 'VmRSS', 'RssAnon', 'RssFile', 'RssShmem', 'VmData', 'VmHWM', 'Threads'):
        match = re.search(r'^' + name + r':\s*(\d+)', status, re.M)
        values[name] = int(match.group(1)) if match else None
    for name in ('Pss', 'Private_Dirty', 'Private_Clean', 'Anonymous'):
        match = re.search(r'^' + name + r':\s*(\d+)', rollup, re.M)
        values[name] = int(match.group(1)) if match else None
    return values

with tempfile.TemporaryDirectory(prefix='nailink-memory-') as temporary:
    root = Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    log = (root / 'runtime.log').open('w+')
    started = time.monotonic()
    child = subprocess.Popen([str(binary), 'run', '--api-only', '--config', str(root / 'state'), '--listen', f'127.0.0.1:{port}'], stdout=log, stderr=log)
    try:
        url = f'http://127.0.0.1:{port}'
        for _ in range(200):
            if child.poll() is not None:
                raise RuntimeError((root / 'runtime.log').read_text())
            try:
                with urllib.request.urlopen(url, timeout=.3) as response:
                    html = response.read().decode()
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('API not ready')
        result = {'binary': str(binary), 'units': 'KiB except Threads', 'apiOnly': True, 'readyMs': round((time.monotonic() - started) * 1000), 'startup': sample(child.pid)}
        time.sleep(2)
        result['idle'] = sample(child.pid)
        assets = re.findall(r'(?:src|href)="\./(assets/[^\"]+)"', html)
        for _ in range(5):
            for asset in assets:
                req = urllib.request.Request(url + '/' + asset, headers={'Accept-Encoding': 'gzip'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    response.read()
        result['afterPanelAssets'] = sample(child.pid)
        time.sleep(2)
        result['settled'] = sample(child.pid)
        print(json.dumps(result, indent=2), flush=True)
    finally:
        child.terminate()
        child.wait(timeout=15)
        log.close()
