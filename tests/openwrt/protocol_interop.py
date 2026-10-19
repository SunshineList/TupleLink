#!/usr/bin/env python3
"""Test real proxy handshakes against an independent loopback sing-box server.

Requires Go, OpenSSL and a separately installed sing-box (tested with 1.14.3).
Run prepare-wing.py first. No provider credentials or router access are used.
"""
import argparse
import base64
import http.server
import json
import os
from pathlib import Path
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import urllib.parse


class HTTP(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        data = b"protocol-payload" * 4096 if self.path == "/payload" else b""
        self.send_response(200 if data else 204)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class UDP(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        sock.sendto(data, self.client_address)


def port(udp=False):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM if udp else socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run(args):
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), HTTP) as http_server, socketserver.UDPServer(("127.0.0.1", 0), UDP) as udp:
        for server in (http_server, udp):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            return run_fixture(args, http_server.server_port, udp.server_address[1])
        finally:
            http_server.shutdown()
            udp.shutdown()


def run_fixture(args, http_port, udp_port):
    with tempfile.TemporaryDirectory(prefix="daed-protocol-") as temp:
        work = Path(temp)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(work / "key.pem"),
            "-out", str(work / "cert.pem"), "-subj", "/CN=fixture.test", "-addext", "subjectAltName=DNS:fixture.test,IP:127.0.0.1", "-days", "1",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tls = {"enabled": True, "certificate_path": str(work / "cert.pem"), "key_path": str(work / "key.pem")}
        inbounds, cases = [], []
        for method in ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305", "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "2022-blake3-chacha20-poly1305"]:
            number = port()
            password = "fixture@pass:2026"
            if method.startswith("2022"):
                password = base64.b64encode(b"k" * (16 if method == "2022-blake3-aes-128-gcm" else 32)).decode()
            inbounds.append({"type": "shadowsocks", "tag": method, "listen": "127.0.0.1", "listen_port": number, "method": method, "password": password})
            user = base64.urlsafe_b64encode((method + ":" + password).encode()).decode().rstrip("=")
            cases.append({"Name": method, "Link": f"ss://{user}@127.0.0.1:{number}"})
        for kind in ["hysteria2", "anytls"]:
            number = port(kind == "hysteria2")
            password = "fixture:pass:2026" if kind == "hysteria2" else "fixture@pass:2026"
            inbounds.append({"type": kind, "tag": kind, "listen": "127.0.0.1", "listen_port": number, "users": [{"name": "fixture", "password": password}], "tls": tls})
            link = f"{kind}://{urllib.parse.quote(password, safe='')}@127.0.0.1:{number}?sni=fixture.test&insecure=1"
            cases.append({"Name": kind, "Link": link})
            if kind == "anytls":
                for option in ["insecure=true", "allowInsecure=true"]:
                    cases.append({"Name": f"anytls-{option}", "Link": link.replace("insecure=1", option)})
                cases.append({"Name": "anytls-certificate-rejected", "Link": link.replace("insecure=1", "insecure=0"), "Failure": "tls_failed"})
            else:
                cases.append({"Name": "hy2-user-password", "Link": link.replace(urllib.parse.quote(password, safe=""), "fixture:pass%3A2026")})
        number = port(True)
        inbounds.append({"type": "hysteria2", "tag": "hy2-obfs", "listen": "127.0.0.1", "listen_port": number, "users": [{"name": "fixture", "password": "fixture"}], "tls": tls, "obfs": {"type": "salamander", "password": "fixture-obfs"}})
        link = f"hy2://fixture@127.0.0.1:{number}?sni=fixture.test&insecure=1&obfs=salamander&obfs-password=fixture-obfs"
        cases.append({"Name": "hysteria2-salamander", "Link": link})
        cases.append({"Name": "hysteria2-obfs-alias-ports", "Link": link.replace("obfs-password", "obfsPassword").replace(f":{number}?", ":1?") + f"&ports={number}-{number}"})
        cases.append({"Name": "hysteria2-mport", "Link": link.replace(f":{number}?", ":1?") + f"&mport={number}"})
        config = work / "config.json"
        config.write_text(json.dumps({"log": {"level": "error"}, "inbounds": inbounds, "outbounds": [{"type": "direct", "tag": "direct"}]}), encoding="utf-8")
        casefile = work / "cases.json"
        casefile.write_text(json.dumps({"Target": f"http://127.0.0.1:{http_port}", "UDP": f"127.0.0.1:{udp_port}", "Cases": cases}), encoding="utf-8")
        subprocess.run([str(args.sing_box), "check", "-c", str(config)], check=True)
        with (work / "server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(args.sing_box), "run", "-c", str(config)], stdout=log, stderr=subprocess.STDOUT)
            try:
                time.sleep(0.6)
                if process.poll() is not None:
                    raise RuntimeError("independent server exited: " + (work / "server.log").read_text())
                env = os.environ.copy()
                env["DAED_PROTOCOL_CASES"] = str(casefile)
                return subprocess.run(["go", "test", "-count=1", "-v", "./graphql/service/node", "./dae", "-run", "TestRouterProtocolInteroperability$|TestRouterHTTPProtocolDownload$"], cwd=args.wing, env=env).returncode
            finally:
                process.terminate()
                process.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wing", type=Path, required=True)
    parser.add_argument("--sing-box", type=Path, required=True)
    raise SystemExit(run(parser.parse_args()))
