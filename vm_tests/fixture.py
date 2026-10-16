#!/usr/bin/python3
"""Disposable guest-only Herdr substitute. Never connects to a host or agent."""
import base64
import json
import os
import signal
import socketserver
import sys

SOCKET = '/run/whistle-vm/herdr.sock'
SNAPSHOT = {
    'panes': [{'pane_id': 'vm:p1', 'terminal_id': 'vm:term1', 'workspace_id': 'vm:w1',
               'tab_id': 'vm:t1', 'agent': 'fixture', 'agent_status': 'idle',
               'label': 'Disposable VM fixture', 'cwd': '/home/whistle', 'scroll': {'viewport_rows': 24}}],
    'workspaces': [{'workspace_id': 'vm:w1', 'label': 'VM fixture'}],
    'tabs': [{'tab_id': 'vm:t1', 'label': 'Fixture'}],
}


class RPC(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            request = json.loads(self.rfile.readline(65536))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            return
        if not isinstance(request, dict):
            return
        method = request.get('method')
        result = None
        if method == 'session.snapshot':
            result = {'snapshot': SNAPSHOT}
        elif method == 'pane.layout':
            result = {'layout': {'panes': [{'pane_id': 'vm:p1', 'rect': {'width': 102, 'height': 26}}]}}
        response = {'id': request.get('id'), 'result': result} if result is not None else {
            'id': request.get('id'), 'error': {'code': 'fixture_only', 'message': 'Unsupported fixture method'}}
        self.wfile.write((json.dumps(response) + '\n').encode())


def main():
    if sys.argv[1:] == ['daemon']:
        if os.path.lexists(SOCKET):
            raise RuntimeError('Fixture socket already exists; refusing to replace it')
        with socketserver.ThreadingUnixStreamServer(SOCKET, RPC) as server:
            os.chmod(SOCKET, 0o600)
            server.serve_forever()
    elif sys.argv[1:3] == ['terminal', 'session']:
        width = int(sys.argv[sys.argv.index('--cols') + 1])
        height = int(sys.argv[sys.argv.index('--rows') + 1])
        print(json.dumps({'type': 'terminal.frame', 'width': width, 'height': height,
                          'bytes': base64.b64encode(b'\x1b[2J\x1b[HDisposable Whistle VM fixture\r\n').decode(),
                          'seq': 1, 'full': True}), flush=True)
        if sys.argv[3] == 'control':
            for line in sys.stdin:
                try:
                    command = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(command, dict) and command.get('type') == 'terminal.release':
                    return
        else:
            while True:
                signal.pause()
    else:
        raise SystemExit('Guest fixture supports daemon and terminal session only')


if __name__ == '__main__':
    main()
