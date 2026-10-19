"""Loopback SOCKS5 fixture that maps only the local synthetic subscription feed."""
import io
import socket
import socketserver
import struct
import threading


def serve_socks(target_port, state):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(5)
            stream = self.request.makefile("rb", buffering=0)

            def read(size):
                data = bytearray()
                while len(data) < size:
                    chunk = stream.read(size - len(data))
                    if not chunk:
                        raise EOFError()
                    data.extend(chunk)
                return bytes(data)

            try:
                version, length = read(2)
                if version != 5 or 0 not in read(length):
                    return
                self.request.sendall(b"\x05\x00")
                version, command, _, kind = read(4)
                if version != 5 or command != 1:
                    return
                if kind == 1:
                    host = socket.inet_ntoa(read(4))
                elif kind == 3:
                    host = read(read(1)[0]).decode("ascii")
                else:
                    return
                port = struct.unpack("!H", read(2))[0]
                if host not in ("127.0.0.1", "localhost") or port != 18081:
                    return
                if state.get("proxy_down"):
                    return
                with socket.create_connection(("127.0.0.1", target_port), timeout=5) as upstream:
                    self.request.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x50")
                    state["proxy_requests"] += 1
                    worker = threading.Thread(target=self.copy, args=(stream, upstream.makefile("wb", buffering=0)), daemon=True)
                    worker.start()
                    with upstream.makefile("rb", buffering=0) as response:
                        self.copy(response, self.request.makefile("wb", buffering=0))
            except (OSError, EOFError, ValueError):
                pass
            finally:
                stream.close()

        @staticmethod
        def copy(source, destination):
            try:
                while chunk := source.read(io.DEFAULT_BUFFER_SIZE):
                    destination.write(chunk)
            except OSError:
                pass

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
