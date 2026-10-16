#!/usr/bin/env python3
"""Explicit integration runner; never collected by bun test or fast unit tests."""
import argparse
import fcntl
import http.client
import json
import os
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from vm_tests.core import (
    ROOT,
    RUNTIME,
    cloud_seed,
    file_hash,
    image_for,
    load_matrix,
    parse_json,
    qemu_args,
    read_text,
    require_host,
    run,
    seed_server,
    ssh_args,
    write_private,
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class VM:
    def __init__(self, case, binary, memory, keep, https=False, browser=False):
        self.case, self.binary, self.memory, self.keep = case, binary, memory, keep
        self.https, self.browser = https, browser
        self.process = self.server = self.login = None
        self.login_pid = None
        self.directory = None
        self.ssh_port = self.http_port = 0
        self.processes = []

    @property
    def origin(self):
        return f'{"https" if self.https else "http"}://127.0.0.1:{self.http_port}'

    def tls_context(self):
        if self.directory is None:
            raise RuntimeError('Missing guest TLS identity')
        return ssl.create_default_context(cafile=str(self.directory / 'tls.crt'))

    def connect(self):
        connection = socket.create_connection(('127.0.0.1', self.http_port), timeout=8)
        try:
            return self.tls_context().wrap_socket(connection, server_hostname='127.0.0.1') if self.https else connection
        except (OSError, RuntimeError):
            connection.close()
            raise

    def remote(self, user, script, *, check=True, **kwargs):
        result = run(ssh_args(self.directory, self.ssh_port, user) + ['bash -se'], data=script, check=False, **kwargs)
        if check and result.returncode:
            if self.directory:
                write_private(self.directory / 'last-ssh-error.log', result.stderr)
            raise RuntimeError(f'Guest {user} command failed (exit {result.returncode}); inspect private diagnostics')
        return result

    def admin(self, script, **kwargs):
        return self.remote('vm-admin', script, **kwargs)

    def user(self, script, **kwargs):
        return self.remote('whistle', 'export XDG_RUNTIME_DIR=/run/user/$(id -u)\n' + script, **kwargs)

    def diagnostics(self):
        if self.directory is None or self.process is None or self.process.poll() is not None:
            return
        try:
            result = self.admin('sudo journalctl --no-pager -n 80 _SYSTEMD_USER_UNIT=whistle.service\n'
                                'sudo systemctl status whistle-vm-herdr --no-pager\n'
                                'sudo journalctl --no-pager -n 30 -u whistle-vm-tls\n', check=False, timeout=12)
            write_private(self.directory / 'guest-diagnostics.log', result.stdout + result.stderr)
        except (RuntimeError, OSError):
            print('Guest diagnostics unavailable; serial/qemu logs retained.', file=sys.stderr)

    def copy(self, source, user, target):
        args = ssh_args(self.directory, self.ssh_port, user)
        # scp uses -P, otherwise reuse the same isolated SSH configuration.
        options = args[1:-1]
        options[options.index('-p')] = '-P'
        run(['scp', *options, str(source), f'{user}@127.0.0.1:{target}'])

    def wait_ssh(self, timeout=600):
        if self.process is None or self.directory is None:
            raise RuntimeError('QEMU was not started')
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            require(self.process.poll() is None, 'QEMU exited; inspect private qemu.log')
            serial = self.directory / 'serial.log'
            if serial.exists():
                boot_log = read_text(serial)
                require(not (boot_log.count('Booting `') >= 3 and 'Linux version ' not in boot_log),
                        'Guest reset loop before kernel startup; inspect virtual hardware and serial.log')
            try:
                if self.admin('true', check=False, timeout=8).returncode == 0:
                    return
            except RuntimeError:
                time.sleep(1)
            time.sleep(2)
        raise RuntimeError('Guest SSH boot timeout; inspect private serial.log')

    def start_login(self):
        self.login = subprocess.Popen(ssh_args(self.directory, self.ssh_port, 'whistle') + ['echo $$; exec sleep 1800'],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.processes.append(self.login)
        stream = self.login.stdout
        if stream is None:
            raise RuntimeError('Missing login pipe')
        pid = stream.readline().strip()
        require(pid.isdigit() and int(pid) > 1, 'Guest login failed')
        self.login_pid = pid

    def end_login(self):
        if self.login is None or self.login_pid is None:
            raise RuntimeError('No owned guest login')
        self.admin(f'sudo -u whistle python3 -c "import os,signal; os.kill({self.login_pid},signal.SIGTERM)"\n')
        self.login.wait(timeout=15)
        self.login = self.login_pid = None

    def request(self, path='/', *, method='GET', body=None, cookie=None, token=None, origin=None):
        connection = (http.client.HTTPSConnection('127.0.0.1', self.http_port, timeout=3, context=self.tls_context())
                      if self.https else http.client.HTTPConnection('127.0.0.1', self.http_port, timeout=3))
        headers = {'Origin': origin or self.origin, 'Connection': 'close'}
        if cookie:
            headers['Cookie'] = cookie
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = connection.getresponse()
            return response.status, {name.lower(): value for name, value in response.getheaders()}, response.read()
        finally:
            connection.close()

    def reachable(self):
        try:
            return self.request()[0] == 200
        except (OSError, http.client.HTTPException):
            return False

    def wait_http(self, expected=True, timeout=40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.reachable() == expected:
                return
            time.sleep(1)
        raise RuntimeError('Unexpected guest HTTP reachability')

    def watch(self, cookie):
        with self.connect() as sock:
            origin = self.origin
            request = (f'GET /terminal?pane=vm:p1&mode=observe HTTP/1.1\r\nHost: 127.0.0.1:{self.http_port}\r\n'
                       f'Origin: {origin}\r\nCookie: {cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                       'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
            sock.sendall(request.encode())
            with sock.makefile('rb') as stream:
                require(b' 101 ' in stream.readline(), 'Watch upgrade failed')
                for _ in range(100):
                    line = stream.readline()
                    if line == b'\r\n':
                        break
                    require(bool(line), 'Truncated WebSocket handshake')
                for _ in range(8):
                    header = stream.read(2)
                    require(len(header) == 2 and not header[1] & 128, 'Invalid server frame')
                    size = header[1] & 127
                    if size == 126:
                        size = struct.unpack('!H', stream.read(2))[0]
                    elif size == 127:
                        size = struct.unpack('!Q', stream.read(8))[0]
                    require(size <= 131072, 'Oversized fixture frame')
                    message = parse_json(stream.read(size))
                    if message.get('type') == 'terminal.frame':
                        require(message.get('mode') == 'observe', 'Unexpected control lease')
                        return
                raise RuntimeError('No fixture terminal frame')

    def boot(self):
        image = image_for(self.case, RUNTIME / 'cache')
        runs = RUNTIME / 'runs'
        runs.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory = Path(tempfile.mkdtemp(prefix=self.case['id'] + '-', dir=runs))
        if self.https:
            run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Whistle disposable VM',
                 '-addext','subjectAltName=IP:127.0.0.1,IP:10.0.2.15,DNS:localhost',
                 '-keyout',str(self.directory/'tls.key'),'-out',str(self.directory/'tls.crt')])
        run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.directory / 'id_ed25519'), '-C', 'whistle-disposable-vm'])
        self.server = seed_server(cloud_seed(self.case, read_text(self.directory / 'id_ed25519.pub'), uuid.uuid4().hex))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        ports = {self.server.server_port}
        while len(ports) < 3:
            ports.add(free_port())
        self.ssh_port, self.http_port = sorted(ports - {self.server.server_port})
        overlay = self.directory / 'disk.qcow2'
        run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(image), str(overlay), '12G'])
        with (self.directory / 'qemu.log').open('w') as log:
            self.process = subprocess.Popen(qemu_args(overlay, self.directory / 'serial.log', self.ssh_port,
                                                       self.http_port, self.server.server_port, self.memory),
                                            stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        self.wait_ssh()
        self.admin('sudo cloud-init status --wait\n', timeout=900)
        for name in ['guest.py', 'fixture.py']:
            self.copy(ROOT / 'vm_tests' / name, 'vm-admin', name)
        self.copy(self.binary, 'whistle', 'download-whistle')
        self.start_login()
        self.admin('sudo python3 ~/guest.py provision\n', timeout=180)
        if self.https:
            for name in ['tls_proxy.py','tls.crt','tls.key']:
                self.copy(ROOT/'vm_tests'/name if name.endswith('.py') else self.directory/name, 'vm-admin', name)
            self.admin('sudo python3 ~/guest.py provision-https\n', timeout=180)

    def close(self):
        if self.process and self.process.poll() is None:
            try:
                self.admin('sudo poweroff\n', check=False, timeout=10)
                self.process.wait(timeout=25)
            except (RuntimeError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=10)
        for child in self.processes:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.directory and not self.keep:
            try:
                shutil.rmtree(self.directory)
            except OSError as error:
                raise RuntimeError('Could not remove stopped guest overlay') from error


def exercise(vm):
    passed = []

    def mark(name):
        passed.append(name)
        print(f"  PASS {name}", flush=True)

    def session(cookie):
        require(vm.request('/api/devices', cookie=cookie)[0] == 200, 'Paired credential lost')

    install_flags = f'--host 127.0.0.1 --port 8791 --public-origin {vm.origin}' if vm.https else '--host 10.0.2.15 --port 8790'
    vm.user('if command -v bun || command -v node; then exit 1; fi\nchmod 700 ~/download-whistle\n'
            'if sudo ~/download-whistle install >/dev/null 2>&1; then exit 1; fi\n'
            'WHISTLE_HERDR_BIN=/usr/local/libexec/whistle-vm-herdr ~/download-whistle install '
            f'{install_flags} --herdr-socket /run/whistle-vm/herdr.sock\n'
            '~/.local/bin/whistle start\n')
    mark('non-root standalone install/start without Bun or Node; root install rejected')
    health_url = 'https://10.0.2.15:8790/' if vm.https else 'http://10.0.2.15:8790/'
    health_context = "ssl.create_default_context(cafile='/etc/whistle-vm-https/cert.pem')" if vm.https else 'None'
    vm.user(f"python3 - <<'PY'\nimport time, ssl, urllib.request\nfor attempt in range(50):\n try:\n  assert urllib.request.urlopen('{health_url}', context={health_context}, timeout=1).status == 200\n  break\n except OSError:\n  time.sleep(0.2)\nelse:\n raise RuntimeError('Guest-local HTTP startup timeout')\nPY\n")
    vm.wait_http(False)
    mark('firewall blocks host access while guest-local service is healthy')
    vm.admin('sudo python3 ~/guest.py allow\n')
    vm.wait_http()
    mark('guest firewall allow exposes only the localhost-forwarded test service')
    manifest_status, manifest_headers, manifest_body = vm.request('/manifest.webmanifest')
    require(manifest_status == 200 and 'application/manifest+json' in manifest_headers.get('content-type',''), 'Manifest missing')
    manifest = parse_json(manifest_body)
    require(manifest.get('start_url') == '/' and manifest.get('display') == 'standalone', 'Invalid install manifest')
    for size in [192,512]:
        status, image_headers, image = vm.request(f'/icon-{size}.png')
        require(status == 200 and image_headers.get('content-type') == 'image/png' and image[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('!II',image[16:24]) == (size,size), 'Invalid embedded PNG')
    require(vm.request('/sw.js')[1].get('cache-control') == 'no-store', 'Worker must not be cached')
    mark('native embedded install manifest, PNG icons and uncached worker')
    if vm.https:
        untrusted = http.client.HTTPSConnection('127.0.0.1', vm.http_port, timeout=3, context=ssl.create_default_context())
        rejected = False
        try:
            untrusted.request('GET','/')
            untrusted.getresponse()
        except ssl.SSLCertVerificationError:
            rejected = True
        finally:
            untrusted.close()
        require(rejected, 'Synthetic CA unexpectedly trusted by host')
        mark('HTTPS certificate verified by test-local CA only; host trust store unchanged')
    require(vm.request('/api/panes')[0] == 401, 'Unauthenticated API accepted')
    require(vm.request('/api/login', method='POST', body={'token': 'wrong'}, origin='https://wrong.invalid')[0] == 403, 'Cross-origin login accepted')
    token = vm.user('cat ~/.local/state/whistle/access-token\n').stdout.strip()
    code, headers, _ = vm.request('/api/login', method='POST', body={'token': token, 'deviceName': 'Disposable VM test'})
    require(code == 200, 'Guest pairing failed')
    require(('; Secure' in headers['set-cookie']) == vm.https, 'Wrong cookie transport security')
    cookie = headers['set-cookie'].split(';')[0]
    device_id = next(d['id'] for d in parse_json(vm.request('/api/devices', cookie=cookie)[2])['devices'] if d['current'])
    mark('authentication, same-origin enforcement and paired device identity')
    pairing_url = parse_json(vm.request('/api/pairing-ticket', method='POST', token=token)[2])['url']
    require(pairing_url.startswith(vm.origin+'/#pair='), 'QR used backend/forged origin')
    ticket = pairing_url.split('#pair=')[1]
    require(vm.request('/api/redeem-pairing', method='POST', body={'ticket': ticket})[0] == 200, 'QR redemption failed')
    require(vm.request('/api/redeem-pairing', method='POST', body={'ticket': ticket})[0] == 401, 'QR reused')
    mark('single-use QR ticket redemption')
    require(parse_json(vm.request('/api/panes', cookie=cookie)[2])['panes'][0]['pane_id'] == 'vm:p1', 'Wrong fixture inventory')
    vm.watch(cookie)
    mark('Unix-socket fake Herdr discovery and read-only WebSocket terminal frame')
    fixture_pid = vm.admin('systemctl show whistle-vm-herdr -p MainPID --value\n').stdout.strip()
    vm.user('~/.local/bin/whistle restart\n')
    vm.wait_http()
    session(cookie)
    mark('real systemd user restart preserves paired cookie')
    vm.user('rm ~/download-whistle\n~/.local/bin/whistle install\n~/.local/bin/whistle restart\n')
    vm.wait_http()
    session(cookie)
    mark('self-install after original download removal preserves state')
    vm.admin('sudo python3 ~/guest.py deny\n')
    vm.wait_http(False)
    vm.user('systemctl --user is-active whistle.service\n')
    vm.admin('sudo python3 ~/guest.py allow\n')
    vm.wait_http()
    session(cookie)
    mark('firewall re-block/re-allow without restarting or resetting authorization')
    vm.user('~/.local/bin/whistle stop\n')
    vm.wait_http(False)
    require(vm.admin('systemctl show whistle-vm-herdr -p MainPID --value\n').stdout.strip() == fixture_pid, 'Whistle stopped fixture daemon')
    vm.user('~/.local/bin/whistle start\n')
    vm.wait_http()
    session(cookie)
    mark('stop/start affects Whistle only; independent fixture daemon survives')
    require(vm.admin('loginctl show-user whistle -p Linger --value\n').stdout.strip() == 'no', 'Unexpected lingering')
    vm.end_login()
    vm.wait_http(False, timeout=60)
    vm.start_login()
    vm.wait_http()
    session(cookie)
    mark('logout stops user daemon; login autostarts it without enabling lingering')
    before_boot = vm.admin('cat /proc/sys/kernel/random/boot_id\n').stdout.strip()
    vm.login = vm.login_pid = None  # The old remote PID must never be used after reboot.
    vm.admin('sudo reboot\n', check=False)
    time.sleep(5)
    vm.wait_ssh()
    require(vm.admin('cat /proc/sys/kernel/random/boot_id\n').stdout.strip() != before_boot, 'Guest did not reboot')
    vm.wait_http(False)
    vm.start_login()
    vm.wait_http()
    session(cookie)
    vm.watch(cookie)
    mark('guest reboot plus fresh login retains installed service, cookie and watch')
    require(vm.request('/api/devices/' + device_id, method='DELETE', token=token)[0] == 200, 'Device revocation failed')
    require(vm.request('/api/devices', cookie=cookie)[0] == 401, 'Revoked cookie still accepted')
    mark('durable device revocation')
    code, headers, _ = vm.request('/api/login', method='POST', body={'token': token, 'deviceName': 'Preserved after uninstall'})
    require(code == 200, 'Second test pairing failed')
    preserved_cookie = headers['set-cookie'].split(';')[0]
    fixture_pid = vm.admin('systemctl show whistle-vm-herdr -p MainPID --value\n').stdout.strip()
    vm.user('~/.local/bin/whistle uninstall\n'
            'test ! -e ~/.local/bin/whistle\ntest -f ~/.local/state/whistle/devices.sqlite\n'
            'test -f ~/.config/whistle/config.json\n')
    vm.wait_http(False)
    require(vm.admin('systemctl show whistle-vm-herdr -p MainPID --value\n').stdout.strip() == fixture_pid, 'Uninstall stopped fixture')
    release = '~/.local/share/whistle/releases/' + file_hash(vm.binary) + '/whistle'
    vm.user(release + ' install\n~/.local/bin/whistle start\n')
    vm.wait_http()
    session(preserved_cookie)
    vm.user("python3 - <<'PY'\nfrom pathlib import Path\nfor path, mode in [('.local/state/whistle',448),('.local/state/whistle/access-token',384),('.local/state/whistle/devices.sqlite',384),('.config/whistle/config.json',384)]:\n assert (Path.home()/path).stat().st_mode & 511 == mode\nPY\n")
    mark('uninstall preserves config/devices/releases; reinstall restores same cookie and private permissions')
    if vm.browser:
        run([shutil.which('bun'), str(ROOT/'vm_tests/browser.ts')], data=json.dumps({'url':vm.origin,'token':token}), timeout=90)
        mark('Android-emulated real guest HTTPS installability, Secure cookie, WSS watch and offline/no-storage checks')
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=[c['id'] for c in load_matrix()])
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--binary', type=Path, default=ROOT / 'dist/whistle')
    parser.add_argument('--memory', type=int, default=1024, choices=[768, 1024, 1536, 2048])
    parser.add_argument('--https', action='store_true', help='TLS fixture with test-local trust, loopback backend and explicit public origin')
    parser.add_argument('--browser', action='store_true', help='Also verify guest HTTPS from host Playwright Android emulation; requires Bun/Chromium')
    parser.add_argument('--keep', action='store_true', help='Keep stopped guest overlay and private diagnostics (never leaves QEMU running)')
    args = parser.parse_args()
    cases = load_matrix()
    if args.list:
        for case in cases:
            print(case['id'] + ': ' + case['os'] + ' / ' + case['firewall'])
        return
    require(bool(args.case) != args.all, 'Select --case NAME or --all explicitly')
    require_host()
    require(not args.browser or args.https, '--browser requires --https')
    require(not args.https or shutil.which('openssl'), 'HTTPS tests require host openssl; nothing is installed automatically')
    require(not args.browser or shutil.which('bun'), 'Browser tests require host Bun and installed Playwright Chromium')
    binary = args.binary.resolve(strict=True)
    require('standalone' in run([str(binary), '--version']).stdout, 'Build native artifact first: bun run package')
    os.umask(0o077)
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (RUNTIME / 'run.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reports = []
        for case in cases:
            if not args.all and case['id'] != args.case:
                continue
            available = next(int(line.split()[1]) for line in read_text('/proc/meminfo').splitlines() if line.startswith('MemAvailable:'))
            require(available > (args.memory + (1024 if args.browser else 512)) * 1024, 'Insufficient available host RAM; guests are never overcommitted automatically')
            print('RUN ' + case['id'] + ' (serial guest, no host firewall/service changes)', flush=True)
            vm = VM(case, binary, args.memory, args.keep, args.https, args.browser)
            success = False
            try:
                vm.boot()
                passed = exercise(vm)
                report = {'case': case, 'transport': 'https' if args.https else 'http', 'browser': args.browser, 'binary_sha256': file_hash(binary), 'passed': passed,
                          'os_release': vm.admin('cat /etc/os-release\n').stdout}
                reports.append(report)
                write_private(RUNTIME / (case['id'] + ('-https' if args.https else '') + '-report.json'), json.dumps(report, indent=2))
                success = True
            finally:
                if not success:
                    vm.keep = True
                    print(f'FAIL {case["id"]}; private diagnostics: {vm.directory}', file=sys.stderr)
                    vm.diagnostics()
                vm.close()
        write_private(RUNTIME / 'report.json', json.dumps(reports, indent=2))
        print(f'PASS {len(reports)} OS/firewall cases; guests shut down; reports under .runtime/vm-tests/', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, StopIteration, http.client.HTTPException, struct.error, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
