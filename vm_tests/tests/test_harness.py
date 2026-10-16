import copy
import hashlib
import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import vm_tests.core as core
import vm_tests.guest as guest
import vm_tests.run as runner


class MatrixTests(unittest.TestCase):
    def setUp(self):
        self.cases = core.load_matrix()

    def reject(self, modify):
        cases = copy.deepcopy(self.cases)
        modify(cases)
        with patch.object(core, 'read_text', return_value=json.dumps({'schema': 1, 'cases': cases})), self.assertRaises(ValueError):
            core.load_matrix()

    def test_three_distinct_pinned_os_firewalls(self):
        self.assertEqual({c['firewall'] for c in self.cases}, {'nftables', 'ufw', 'firewalld'})
        self.assertEqual(len(self.cases), 3)

    def test_reject_duplicate_and_unsafe_ids(self):
        self.reject(lambda cases: cases.append(cases[0]))
        self.reject(lambda cases: cases[0].update(id='../escape'))

    def test_reject_http_untrusted_mutable_and_credential_urls(self):
        for url in ['http://cloud.debian.org/image', 'https://untrusted.invalid/image',
                    'https://user:password@cloud.debian.org/image', 'https://cloud.debian.org/latest/image',
                    'https://cloud.debian.org/image?token=secret']:
            self.reject(lambda cases, url=url: cases[0].update(image_url=url))

    def test_reject_unpinned_checksum_and_unknown_firewall(self):
        self.reject(lambda cases: cases[0].update(checksum=''))
        self.reject(lambda cases: cases[0].update(hash_algorithm='md5'))
        self.reject(lambda cases: cases[0].update(firewall='host'))
        self.reject(lambda cases: cases[0].update(packages=['python3; execute']))

    def test_seed_only_contains_disposable_guest_identity(self):
        seed = core.cloud_seed(self.cases[0], 'ssh-ed25519 ZmFrZQ== fixture', 'a' * 32)
        config = core.parse_json(seed['user-data'].split('\n', 1)[1])
        self.assertEqual([user['name'] for user in config['users']], ['vm-admin', 'whistle'])
        self.assertFalse(config['ssh_pwauth'])
        self.assertTrue(config['disable_root'])
        self.assertNotIn(str(Path.home()), seed['user-data'])
        self.assertNotIn('enable-linger', seed['user-data'])
        self.assertEqual(core.parse_json(seed['meta-data'])['instance-id'], 'a' * 32)

    def test_invalid_seed_identity_refused(self):
        with self.assertRaises(ValueError):
            core.cloud_seed(self.cases[0], 'ssh-rsa key', 'a' * 32)


class IsolationTests(unittest.TestCase):
    def test_qemu_is_kvm_serial_cpu_bounded_and_loopback_forwarded(self):
        args = core.qemu_args('/overlay', '/serial', 2222, 8799, 8888)
        self.assertEqual(args[args.index('-smp') + 1], '1')
        self.assertEqual(args[args.index('-m') + 1], '1024')
        network = args[args.index('-netdev') + 1]
        self.assertTrue(network.startswith('user,'))
        self.assertIn('hostfwd=tcp:127.0.0.1:2222-:22', network)
        self.assertIn('hostfwd=tcp:127.0.0.1:8799-:8790', network)
        self.assertNotIn('-virtfs', args)
        self.assertNotIn('tap', network)
        self.assertIn('-sandbox', args)
        self.assertEqual(args[args.index('-machine') + 1], 'pc-q35-9.2')
        self.assertIn('VGA', args)
        self.assertEqual(args[args.index('-display') + 1], 'none')
        unusual = core.qemu_args('/folder,with spaces/disk.qcow2', '/serial', 2222, 8799, 8888)
        disk = core.parse_json(unusual[unusual.index('-blockdev') + 1])
        self.assertEqual(disk['file']['filename'], '/folder,with spaces/disk.qcow2')

    def test_https_uses_a_test_local_ca_and_requires_hostname_verification(self):
        machine = runner.VM({}, Path('/binary'), 1024, False, https=True)
        machine.directory, machine.http_port = Path('/disposable'), 12345
        context = runner.ssl.create_default_context()
        with patch.object(runner.ssl, 'create_default_context', return_value=context) as trust, patch.object(runner.http.client, 'HTTPSConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status, response.read.return_value, response.getheaders.return_value = 200, b'ok', []
            machine.request()
            trust.assert_called_once_with(cafile='/disposable/tls.crt')
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, runner.ssl.CERT_REQUIRED)
            self.assertEqual(connection.call_args.kwargs['context'], context)
            self.assertEqual(connection.return_value.request.call_args.args[3]['Origin'], 'https://127.0.0.1:12345')
            connection.return_value.close.assert_called_once()

    def test_wss_verification_failure_closes_owned_socket(self):
        machine = runner.VM({}, Path('/binary'), 1024, False, https=True)
        raw = Mock()
        context = Mock(wrap_socket=Mock(side_effect=runner.ssl.SSLCertVerificationError('synthetic test failure')))
        with patch.object(runner.socket, 'create_connection', return_value=raw), patch.object(machine, 'tls_context', return_value=context), self.assertRaises(runner.ssl.SSLCertVerificationError):
            machine.connect()
        raw.close.assert_called_once()

    def test_tls_provisioning_cannot_bypass_guest_guard(self):
        with patch.object(guest.sys, 'argv', ['guest.py','provision-https']), patch.object(guest, 'guard', side_effect=RuntimeError('not guest')), patch.object(guest, 'provision_https') as provision:
            with self.assertRaises(RuntimeError):
                guest.main()
            provision.assert_not_called()

    def test_plain_http_remains_the_default_vm_transport(self):
        machine = runner.VM({}, Path('/binary'), 1024, False)
        machine.http_port = 12345
        self.assertEqual(machine.origin, 'http://127.0.0.1:12345')
        self.assertFalse(machine.https)
        self.assertFalse(machine.browser)

    def test_http_headers_are_case_insensitive_and_connections_are_closed(self):
        machine = runner.VM({}, Path('/binary'), 1024, False)
        machine.http_port = 12345
        with patch.object(runner.http.client, 'HTTPConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            response.getheaders.return_value = [('sEt-CoOkIe', 'fixture=only')]
            response.read.return_value = b'ok'
            status, headers, body = machine.request()
            self.assertEqual((status, headers['set-cookie'], body), (200, 'fixture=only', b'ok'))
            connection.return_value.close.assert_called_once()

    def test_early_boot_loop_fails_before_ssh_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            machine = runner.VM({}, Path('/binary'), 1024, False)
            machine.directory = Path(directory)
            core.write_private(machine.directory / 'serial.log', 'Booting `Debian GNU/Linux`\n' * 3)
            with patch.object(machine, 'process', Mock(poll=Mock(return_value=None))), patch.object(machine, 'admin') as ssh:
                with self.assertRaisesRegex(RuntimeError, 'reset loop'):
                    machine.wait_ssh()
                ssh.assert_not_called()

    def test_logout_signals_only_the_owned_guest_login_as_its_user(self):
        machine = runner.VM({}, Path('/binary'), 1024, False)
        machine.login_pid = '12345'
        login = Mock()
        with patch.object(machine, 'login', login), patch.object(machine, 'admin') as remote:
            machine.end_login()
            self.assertIn('sudo -u whistle python3', remote.call_args.args[0])
            self.assertIn('os.kill(12345,signal.SIGTERM)', remote.call_args.args[0])
            login.wait.assert_called_once()
            self.assertIsNone(machine.login_pid)

    def test_remote_failures_keep_only_private_stderr_not_secret_stdout(self):
        with tempfile.TemporaryDirectory() as directory:
            machine = runner.VM({}, Path('/binary'), 1024, False)
            machine.directory = Path(directory)
            machine.ssh_port = 2222
            result = subprocess.CompletedProcess(['ssh'], 1, 'private-cookie', 'guest error')
            with patch.object(runner, 'run', return_value=result), self.assertRaises(RuntimeError):
                machine.user('test command')
            diagnostic = machine.directory / 'last-ssh-error.log'
            self.assertEqual(core.read_text(diagnostic), 'guest error')
            self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)

    def test_invalid_resources_ports_and_ssh_targets_refused(self):
        for ports, memory in [((22, 8799, 8888), 1024), ((2222, 2222, 8888), 1024), ((2222, 8799, 8888), 4096)]:
            with self.assertRaises(ValueError):
                core.qemu_args('/overlay', '/serial', *ports, memory)
        with self.assertRaises(ValueError):
            core.ssh_args(Path('/keys'), 22)
        with self.assertRaises(ValueError):
            core.ssh_args(Path('/keys'), 2222, 'root')

    def test_ssh_has_no_agent_forwarding_or_user_config(self):
        args = core.ssh_args(Path('/keys'), 2222)
        self.assertEqual(args[-1], 'vm-admin@127.0.0.1')
        self.assertIn('ForwardAgent=no', args)
        self.assertIn('IdentitiesOnly=yes', args)
        self.assertIn('/dev/null', args)

    def test_command_failures_never_dump_secret_output(self):
        failure = subprocess.CompletedProcess(['ssh'], 1, 'private-cookie', 'private-token')
        with patch.object(core.subprocess, 'run', return_value=failure), self.assertRaises(RuntimeError) as raised:
            core.run(['ssh'])
        self.assertNotIn('private', str(raised.exception))

    def test_root_or_missing_kvm_never_triggers_automatic_installation(self):
        with patch.object(core.os, 'getuid', return_value=0), self.assertRaises(RuntimeError):
            core.require_host()
        with patch.object(core.os, 'getuid', return_value=1000), patch.object(core.os, 'access', return_value=False), self.assertRaises(RuntimeError):
            core.require_host()

    def test_seed_server_has_no_directory_serving(self):
        import http.client
        server = core.seed_server({'user-data': 'guest-only'})
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path, status in [('/seed/user-data', 200), ('/seed/../../access-token', 404), ('/', 404)]:
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
                connection.request('GET', path)
                response = connection.getresponse()
                self.assertEqual(response.status, status)
                response.read()
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class ImageTests(unittest.TestCase):
    def test_corrupt_cached_image_is_never_booted(self):
        with tempfile.TemporaryDirectory() as directory:
            case = copy.deepcopy(core.load_matrix()[0])
            case.update(hash_algorithm='sha256', checksum=hashlib.sha256(b'expected').hexdigest())
            (Path(directory) / (case['checksum'] + '.qcow2')).write_bytes(b'wrong')
            with patch.object(core, 'run') as execute:
                with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                    core.image_for(case, Path(directory))
                execute.assert_not_called()

    def test_symlink_cache_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            case = copy.deepcopy(core.load_matrix()[0])
            target = Path(directory) / 'target'
            target.write_text('unrelated')
            (Path(directory) / (case['checksum'] + '.qcow2')).symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                core.image_for(case, Path(directory))
            self.assertEqual(core.read_text(target), 'unrelated')


class GuestSafetyTests(unittest.TestCase):
    def test_host_cannot_enter_guest_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'absent'
            with self.assertRaises(RuntimeError):
                guest.guard(marker, marker)

    def test_guest_guard_requires_marker_qemu_and_root(self):
        with tempfile.TemporaryDirectory() as directory:
            marker, vendor = Path(directory) / 'marker', Path(directory) / 'vendor'
            marker.write_text(json.dumps({'kind': 'whistle-disposable-qemu', 'run_id': 'b' * 32, 'firewall': 'ufw'}))
            vendor.write_text('QEMU')
            with patch.object(guest.os, 'geteuid', return_value=0):
                self.assertEqual(guest.guard(marker, vendor), 'ufw')
                vendor.write_text('physical PC')
                with self.assertRaises(RuntimeError):
                    guest.guard(marker, vendor)
            vendor.write_text('QEMU')
            with patch.object(guest.os, 'geteuid', return_value=1000), self.assertRaises(RuntimeError):
                guest.guard(marker, vendor)

    def test_nft_policy_always_preserves_ssh_and_loopback(self):
        for allowed in [False, True]:
            policy = guest.nft_policy(allowed)
            self.assertIn('tcp dport 22 accept', policy)
            self.assertIn('iifname "lo" accept', policy)
            self.assertIn('policy drop', policy)
            self.assertEqual('tcp dport 8790 accept' in policy, allowed)

    def test_alternate_firewalls_only_receive_fixed_guest_service_port(self):
        with patch.object(guest, 'call') as execute:
            guest.firewall('ufw', True)
            self.assertEqual(execute.call_args.args[0], ['ufw', 'allow', '8790/tcp'])
            guest.firewall('firewalld', False)
            self.assertEqual(execute.call_args_list[-2].args[0], ['firewall-cmd', '--permanent', '--zone=public', '--remove-port=8790/tcp'])


if __name__ == '__main__':
    unittest.main()
