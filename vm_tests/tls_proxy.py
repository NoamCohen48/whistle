#!/usr/bin/python3
"""Disposable guest-only TLS byte proxy; not a production proxy implementation."""
import select
import socket
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Proxy(BaseHTTPRequestHandler):
    def do_GET(self):
        self.close_connection = True
        try:
            upstream = socket.create_connection(('127.0.0.1', 8791), timeout=5)
        except OSError:
            self.send_error(502, 'Guest backend unavailable')
            return
        with upstream:
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 <= size <= 4096:
                    self.send_error(413)
                    return
                head = f'{self.command} {self.path} {self.request_version}\r\n'
                head += ''.join(f'{name}: {value}\r\n' for name,value in self.headers.items()) + '\r\n'
                upstream.sendall(head.encode('iso-8859-1') + self.rfile.read(size))
                while True:
                    ready,_,_ = select.select([self.connection,upstream],[],[],30)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        (upstream if source is self.connection else self.connection).sendall(data)
            except (OSError, ValueError):
                return  # Disconnected test client; never log headers or payloads.

    do_POST = do_DELETE = do_HEAD = do_GET

    def log_message(self, format, *args):
        return


def main():
    if not Path('/etc/whistle-vm-test').exists() or 'QEMU' not in Path('/sys/class/dmi/id/sys_vendor').read_text():
        raise RuntimeError('TLS fixture requires a marked disposable QEMU guest')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain('/etc/whistle-vm-https/cert.pem', '/etc/whistle-vm-https/key.pem')
    server = ThreadingHTTPServer(('10.0.2.15',8790),Proxy)
    server.daemon_threads = True
    server.socket = context.wrap_socket(server.socket,server_side=True)
    with server:
        server.serve_forever()


if __name__ == '__main__':
    main()
