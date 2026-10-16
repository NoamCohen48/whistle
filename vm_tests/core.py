"""Rootless VM primitives. No host service/firewall/package-manager operations."""
import hashlib
import json
import os
import re
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / '.runtime' / 'vm-tests'
DOMAINS = {'cloud.debian.org', 'cloud-images.ubuntu.com', 'dl.fedoraproject.org'}
FIREWALLS = {'nftables', 'ufw', 'firewalld'}


def read_text(path):
    try:
        return Path(path).read_text(encoding='utf8')
    except OSError as error:
        raise RuntimeError(f'Cannot read {path}') from error


def parse_json(value):
    try:
        return json.loads(value)
    except (ValueError, TypeError) as error:
        raise RuntimeError('Invalid JSON') from error


def write_private(path, text):
    try:
        Path(path).write_text(text, encoding='utf8')
        Path(path).chmod(0o600)
    except OSError as error:
        raise RuntimeError(f'Cannot write {path}') from error


def run(args, *, data=None, check=True, timeout=600):
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f'Could not execute {Path(args[0]).name}') from error
    if check and result.returncode:
        # Never dump command input/output: SSH/API output can contain guest secrets.
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode})')
    return result


def file_hash(path, algorithm='sha256'):
    try:
        with Path(path).open('rb') as stream:
            return hashlib.file_digest(stream, algorithm).hexdigest()
    except OSError as error:
        raise RuntimeError(f'Cannot hash {path}') from error


def load_matrix(path=ROOT / 'vm_tests/matrix.json'):
    matrix = parse_json(read_text(path))
    if matrix.get('schema') != 1 or not isinstance(matrix.get('cases'), list):
        raise ValueError('Unsupported VM matrix schema')
    ids = set()
    for case in matrix['cases']:
        name = case.get('id', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,40}', name) or name in ids:
            raise ValueError('Unsafe or duplicate VM case ID')
        ids.add(name)
        url = urllib.parse.urlsplit(case.get('image_url', ''))
        if url.scheme != 'https' or url.hostname not in DOMAINS or url.username or url.query or url.fragment:
            raise ValueError('Image must use an allowlisted official HTTPS publisher')
        if '/latest/' in url.path or '/release/' in url.path:
            raise ValueError('Pin an immutable image version, not latest/release')
        algorithm = case.get('hash_algorithm')
        size = {'sha256': 64, 'sha512': 128}.get(algorithm)
        if not size or not re.fullmatch(r'[0-9a-f]{' + str(size) + '}', case.get('checksum', '')):
            raise ValueError('A complete pinned checksum is required')
        if case.get('firewall') not in FIREWALLS:
            raise ValueError('Unknown guest firewall')
        if not isinstance(case.get('packages'), list) or not all(re.fullmatch(r'[a-z0-9-]+', p) for p in case['packages']):
            raise ValueError('Invalid guest package list')
    return matrix['cases']


def image_for(case, cache):
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    image = cache / (case['checksum'] + '.qcow2')
    if not image.exists():
        temporary = image.with_suffix('.download')
        run(['curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
             '--proto-redir', '=https', '--retry', '2', '--max-time', '900', '--output', str(temporary), case['image_url']], timeout=920)
        if file_hash(temporary, case['hash_algorithm']) != case['checksum']:
            raise RuntimeError('Downloaded image checksum mismatch; refusing to boot')
        temporary.chmod(0o444)
        temporary.replace(image)
    if image.is_symlink() or file_hash(image, case['hash_algorithm']) != case['checksum']:
        raise RuntimeError('Cached image checksum mismatch or symlink; refusing to boot')
    info = parse_json(run(['qemu-img', 'info', '--output=json', str(image)]).stdout)
    if info.get('format') != 'qcow2' or info.get('backing-filename') or info.get('virtual-size', 0) > 32 * 1024**3:
        raise RuntimeError('Unexpected base image format/backing file/size')
    return image


def cloud_seed(case, public_key, run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id) or not public_key.startswith('ssh-ed25519 '):
        raise ValueError('Invalid ephemeral guest identity')
    users = [{'name': name, 'shell': '/bin/bash', 'lock_passwd': True,
              'sudo': 'ALL=(ALL) NOPASSWD:ALL', 'ssh_authorized_keys': [public_key.strip()]}
             for name in ['vm-admin', 'whistle']]
    config = {'users': users, 'disable_root': True, 'ssh_pwauth': False,
              'package_update': True, 'package_upgrade': False, 'packages': case['packages'],
              'write_files': [{'path': '/etc/whistle-vm-test', 'permissions': '0600',
                               'content': json.dumps({'kind': 'whistle-disposable-qemu', 'run_id': run_id, 'firewall': case['firewall']})}]}
    return {'user-data': '#cloud-config\n' + json.dumps(config),
            'meta-data': json.dumps({'instance-id': run_id, 'local-hostname': 'whistle-vm'}), 'vendor-data': ''}


def seed_server(payload):
    class SeedHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            key = self.path.removeprefix('/seed/')
            if not self.path.startswith('/seed/') or key not in payload:
                self.send_error(404)
                return
            body = payload[key].encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return
    return ThreadingHTTPServer(('127.0.0.1', 0), SeedHandler)


def qemu_args(overlay, serial, ssh_port, http_port, seed_port, memory=1024):
    if not 768 <= memory <= 2048 or any(not 1024 < p < 65536 for p in [ssh_port, http_port, seed_port]):
        raise ValueError('Unsafe VM resources or forwarding port')
    if len({ssh_port, http_port, seed_port}) != 3:
        raise ValueError('Forwarding/seed ports must be distinct')
    # Cloud GRUB/kernel boot needs a virtual VGA device even without a display.
    disk = json.dumps({'driver': 'qcow2', 'node-name': 'disk', 'file': {'driver': 'file', 'filename': str(overlay)}})
    return ['qemu-system-x86_64', '-machine', 'pc-q35-9.2', '-accel', 'kvm', '-cpu', 'host', '-smp', '1', '-m', str(memory),
            '-nodefaults', '-device', 'VGA', '-display', 'none', '-monitor', 'none', '-serial', 'file:' + str(serial),
            '-blockdev', disk, '-device', 'virtio-blk-pci,drive=disk', '-device', 'virtio-net-pci,netdev=net0',
            '-netdev', f'user,id=net0,hostfwd=tcp:127.0.0.1:{ssh_port}-:22,hostfwd=tcp:127.0.0.1:{http_port}-:8790',
            '-device', 'virtio-rng-pci', '-smbios', f'type=1,serial=ds=nocloud;s=http://10.0.2.2:{seed_port}/seed/',
            '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny']


def ssh_args(directory, port, user='vm-admin'):
    if user not in {'vm-admin', 'whistle'} or not 1024 < port < 65536:
        raise ValueError('Unsafe SSH target')
    return ['ssh', '-F', '/dev/null', '-i', str(directory / 'id_ed25519'), '-p', str(port),
            '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
            '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'UserKnownHostsFile=' + str(directory / 'known_hosts'), f'{user}@127.0.0.1']


def require_host():
    if os.getuid() == 0:
        raise RuntimeError('Run VM tests as your regular user, not root')
    try:
        available = os.access('/dev/kvm', os.R_OK | os.W_OK)
    except OSError as error:
        raise RuntimeError('Cannot check KVM access') from error
    if not available:
        raise RuntimeError('KVM unavailable; no root/system changes are performed automatically')
