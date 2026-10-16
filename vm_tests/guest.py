#!/usr/bin/python3
"""Privileged operations permitted only inside an explicitly marked QEMU guest."""
import json
import os
import pwd
import re
import shutil
import subprocess
import sys
from pathlib import Path

FIREWALLS = {'nftables', 'ufw', 'firewalld'}


def guard(marker=Path('/etc/whistle-vm-test'), vendor=Path('/sys/class/dmi/id/sys_vendor')):
    try:
        value = json.loads(marker.read_text())
        manufacturer = vendor.read_text()
    except (OSError, ValueError) as error:
        raise RuntimeError('Refusing operations outside a marked disposable QEMU guest') from error
    if (os.geteuid() != 0 or value.get('kind') != 'whistle-disposable-qemu'
            or not re.fullmatch(r'[a-f0-9]{32}', value.get('run_id', ''))
            or value.get('firewall') not in FIREWALLS or 'QEMU' not in manufacturer):
        raise RuntimeError('Invalid guest safety marker/vendor/privilege')
    return value['firewall']


def call(args, *, data=None, check=True):
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('Guest command unavailable/timed out') from error
    if check and result.returncode:
        raise RuntimeError(f'Guest {Path(args[0]).name} failed (exit {result.returncode})')
    return result.stdout


def nft_policy(allowed):
    port_rule = 'tcp dport 8790 accept' if allowed else ''
    return f'''flush ruleset
table inet whistle_vm_test {{
 chain input {{ type filter hook input priority 0; policy drop;
  iifname "lo" accept
  ct state established,related accept
  tcp dport 22 accept
  {port_rule}
 }}
 chain forward {{ type filter hook forward priority 0; policy drop; }}
 chain output {{ type filter hook output priority 0; policy accept; }}
}}
'''


def firewall(kind, allowed):
    if kind == 'nftables':
        policy = nft_policy(allowed)
        Path('/etc/nftables.conf').write_text(policy)
        call(['nft', '-f', '-'], data=policy)
    elif kind == 'ufw':
        call(['ufw', 'allow', '8790/tcp'] if allowed else ['ufw', '--force', 'delete', 'allow', '8790/tcp'], check=allowed)
    elif kind == 'firewalld':
        call(['firewall-cmd', '--permanent', '--zone=public', ('--add-port=' if allowed else '--remove-port=') + '8790/tcp'], check=allowed)
        call(['firewall-cmd', '--reload'])
    else:
        raise ValueError('Unknown firewall')


def provision(kind):
    directory = Path('/usr/local/libexec')
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / 'whistle-vm-herdr'
    shutil.copyfile(Path(__file__).with_name('fixture.py'), destination)
    destination.chmod(0o755)
    unit = '''[Unit]
Description=Disposable Whistle VM fake Herdr (never a real agent)
[Service]
User=whistle
RuntimeDirectory=whistle-vm
ExecStart=/usr/local/libexec/whistle-vm-herdr daemon
Restart=on-failure
UMask=0077
[Install]
WantedBy=multi-user.target
'''
    Path('/etc/systemd/system/whistle-vm-herdr.service').write_text(unit)
    call(['systemctl', 'daemon-reload'])
    call(['systemctl', 'enable', '--now', 'whistle-vm-herdr.service'])
    if kind == 'nftables':
        firewall(kind, False)
        call(['systemctl', 'enable', '--now', 'nftables'])
    elif kind == 'ufw':
        call(['ufw', '--force', 'reset'])
        call(['ufw', 'default', 'deny', 'incoming'])
        call(['ufw', 'default', 'allow', 'outgoing'])
        call(['ufw', 'allow', '22/tcp'])
        call(['ufw', '--force', 'enable'])
    else:
        call(['systemctl', 'enable', '--now', 'firewalld'])
        call(['firewall-cmd', '--permanent', '--zone=public', '--add-service=ssh'])
        call(['firewall-cmd', '--set-default-zone=public'])
        try:
            routes = json.loads(call(['ip', '-j', 'route', 'show', 'default']))
        except ValueError as error:
            raise RuntimeError('Cannot identify guest NIC') from error
        interface = routes[0]['dev']
        call(['firewall-cmd', '--permanent', '--zone=public', '--change-interface=' + interface])
        call(['firewall-cmd', '--reload'])
    # Ensure the freshly installed user-bus socket is loaded before lifecycle tests.
    uid = pwd.getpwnam('whistle').pw_uid
    call(['systemctl', 'restart', f'user@{uid}.service'])


def provision_https():
    source = Path(__file__).parent
    directory = Path('/etc/whistle-vm-https')
    directory.mkdir(mode=0o700)
    user = pwd.getpwnam('whistle')
    for name, source_name in [('cert.pem','tls.crt'),('key.pem','tls.key')]:
        target = directory / name
        shutil.copyfile(source / source_name, target)
        target.chmod(0o600)
        os.chown(target, user.pw_uid, user.pw_gid)
    os.chown(directory, user.pw_uid, user.pw_gid)
    target = Path('/usr/local/libexec/whistle-vm-tls')
    shutil.copyfile(source / 'tls_proxy.py', target)
    target.chmod(0o755)
    Path('/etc/systemd/system/whistle-vm-tls.service').write_text('''[Unit]
Description=Disposable Whistle VM TLS fixture
After=network-online.target
Wants=network-online.target
[Service]
User=whistle
ExecStart=/usr/bin/python3 /usr/local/libexec/whistle-vm-tls
Restart=on-failure
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
''')
    call(['systemctl','daemon-reload'])
    call(['systemctl','enable','--now','whistle-vm-tls.service'])


def main():
    kind = guard()
    if sys.argv[1:] == ['provision']:
        provision(kind)
    elif sys.argv[1:] == ['provision-https']:
        provision_https()
    elif sys.argv[1:] in [['allow'], ['deny']]:
        firewall(kind, sys.argv[1] == 'allow')
    else:
        raise ValueError('Use provision, provision-https, allow or deny')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, IndexError):
        print('Guest operation failed (sensitive output omitted)', file=sys.stderr)
        raise SystemExit(1) from None
