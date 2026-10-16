# Reproducible Linux VM tests

Real guest systemd, user sessions and firewalls; no real Herdr or agents. These tests exercise the standalone companion, not an alternative agent harness.

## Matrix

| Case | Official pinned image | Guest firewall |
| --- | --- | --- |
| `debian13-nftables` | Debian 13, `20261015-2632` | nftables |
| `ubuntu2404-ufw` | Ubuntu 24.04 LTS, `20260926` | UFW |
| `fedora44-firewalld` | Fedora Cloud 44, `1.7` | firewalld |

[`matrix.json`](matrix.json) contains versioned publisher URLs, SHA-256/SHA-512 checksums and required guest packages. Every cached image is rehashed before use. Corrupt images, symlinks, backing files, mutable URLs and unexpected image formats/sizes are rejected. A retired image fails closed; updating a pin requires reviewing the official publisher's checksum, not substituting `latest`.

The image and tested executable are checksum-pinned. Guest package indexes are refreshed and packages installed from distro repositories; these packages are **not** snapshot-pinned. This is a repeatable test setup, not a byte-reproducible OS build. Windows/macOS are outside the current Linux/systemd companion's support scope.

## Host prerequisites

- Linux x86-64, an ordinary user with read/write access to `/dev/kvm`.
- QEMU 9.2+ with the `pc-q35-9.2` compatibility machine, `qemu-img` and user-mode networking.
- Python 3.11+, `curl`, OpenSSH client (`ssh`, `scp`, `ssh-keygen`). No Python dependencies.
- A built Linux x64 standalone Whistle executable; Bun is needed to build it, **not inside guests**.
- Internet access for official image downloads and guest package repositories; several GiB of disk space.

The runner does not install missing host dependencies or change KVM permissions. Guests run **serially**, with one vCPU and 1024 MiB RAM by default. Before each guest it requires available host RAM greater than guest RAM plus 512 MiB. Each guest has a sparse 12 GiB disposable disk overlay. Base images remain cached.

Run from the repository root:

```sh
bun run package
bun run test:vm:unit
bun run test:vm --list
bun run test:vm --case debian13-nftables
bun run test:vm --all
```

Without Bun, after obtaining the executable:

```sh
python3 -m unittest discover -s vm_tests/tests -t . -v
python3 -m vm_tests.run --all --binary /absolute/path/to/whistle
```

Options: `--memory 768|1024|1536|2048`, `--keep` (retain **stopped** guests), `--binary PATH`. `--case` and `--all` are mutually exclusive. Merely listing cases, running unit tests, or running ordinary `bun test` never downloads or starts a VM.

## HTTPS and browser probes

```sh
bun run test:vm --all --https
bun run test:vm --all --https --browser
```

`--https` additionally needs host OpenSSL. It creates a fresh two-day synthetic certificate/key, copies them only into the disposable guest, and runs a guest-only TLS byte proxy at port 8790 to Whistle on loopback port 8791. Whistle is installed with the explicit public HTTPS origin. Python HTTPS/WSS clients verify the synthetic certificate and hostname using a **test-local CA context**. A negative check proves the host's normal trust store rejects it. Guest firewalls still exercise the same external port.

`--browser` requires `--https`, host Bun, project dependencies and installed Playwright Chromium. It launches a temporary Android-emulated browser against the actual guest-native UI, checks Chromium installability, Secure/HttpOnly/Strict cookies, WSS watch and offline/no-storage behavior, then closes it. Only this synthetic browser process ignores certificate errors; no system/browser trust store or persistent profile is modified. Its guest-only token arrives on stdin, not argv, and no screenshots, traces or browser-storage snapshots are saved. An extra 1024 MiB available-RAM margin is required for this mode.

This is not production certificate/phone validation. `tls_proxy.py` is a **disposable test fixture**, not a suggested production TLS proxy.

## Isolation and safety boundaries

- QEMU/KVM runs unprivileged with its seccomp sandbox, no display, no monitor and no host filesystem shares. The headless virtual VGA device is intentional: removing it caused a pre-kernel reboot loop in the pinned Debian cloud image.
- New SSH key, accounts, cloud-init instance ID and qcow2 overlay for every run. No SSH-agent/X11 forwarding or user SSH configuration. Host config, cookies, credentials and Herdr sockets are never copied.
- SSH and test HTTP forwards bind to **127.0.0.1 only**, using temporary high ports. Cloud-init receives only a guest marker and ephemeral public key through a loopback seed server.
- QEMU user networking permits outbound traffic for package installation and includes the usual host alias. This is **not an air-gapped or hostile-image security boundary**. Only checksum-pinned official images are used. The harness never directs requests to host agents or existing Whistle services.
- Guest-only fake Herdr owns `/run/whistle-vm/herdr.sock` and produces a fixed synthetic terminal frame. No host checkout, home, socket or agent process is exposed through a shared mount.
- `guest.py` refuses privileged operations unless root, a correctly structured disposable marker and QEMU DMI vendor are all present. Firewall reset/enable, package installation and service changes happen **inside the guest only**. Never run this helper with host sudo.
- No host firewall, Tailscale, routing, DNS, lingering, user units, installed Whistle releases or device authorizations are changed. The host binary is invoked only for `--version` and copied to the guest.

## Integration scenarios

Each OS/firewall case verifies:

1. Native user-service install/start without Bun or Node; root install rejected.
2. Firewall blocking while guest-local HTTP is healthy.
3. Firewall allow makes the localhost-forwarded service reachable.
4. Unauthorized API rejection, cross-origin login rejection and paired device identity.
5. Single-use QR ticket redemption.
6. Fake Herdr Unix-socket inventory and read-only WebSocket terminal frame.
7. Real user-systemd restart preserving the cookie/device.
8. Same-build self-install after deleting the original download.
9. Firewall re-block/re-allow preserving authorization.
10. Stop/start without stopping the independent fake Herdr service.
11. Logout stops the daemon; fresh login autostarts it without enabling lingering.
12. Real guest reboot followed by login preserves service, cookie and watch.
13. Durable device revocation rejects the old cookie.
14. Uninstall preserves configuration/devices/releases; reinstall accepts the saved cookie and retains private file modes.
15. Embedded manifest, original PNG bytes/dimensions and uncached worker.

HTTPS adds a certificate/host-trust check (16); optional browser mode adds actual guest PWA/Secure-cookie/WSS/offline checks (17).

Same-build self-install is not a distinct-version upgrade or schema migration test. Plain-HTTP mode does not prove TLS. Even HTTPS/browser mode does not prove the real Tailscale endpoint, trusted production certificates, physical Android input, real-phone lifecycle or compatibility with every Herdr release. Those remain separate validations.

## Reports and cleanup

Everything generated is private and Git-ignored under `.runtime/vm-tests/`:

- `cache/`: checksum-addressed, read-only base images.
- `runs/`: disposable overlays, ephemeral SSH keys, synthetic TLS keys and private diagnostics.
- `<case>-report.json` / `<case>-https-report.json`: successful case metadata, executable hash, OS release and passed scenario names. No tokens, cookies, QR tickets or terminal payloads.
- `report.json`: cases from the latest successful invocation (a single-case run contains one case).

Success removes the stopped guest's overlay and keys unless `--keep` is supplied. Failure shuts down the guest and retains diagnostics for investigation; it does not leave a VM running. The runner holds an exclusive lock to prevent concurrent matrices. Treat retained guest disks/keys as disposable test credentials: do not upload them. Remove stopped run directories after debugging; remove cached images only when no runner is active.

## Recorded baseline

The HTTPS/browser matrix passed **17 scenarios on each of Debian/nftables, Ubuntu/UFW and Fedora/firewalld (51 results)** in one serial `--all --https --browser` run. All 26 fast harness tests and project Pyright checks pass. Tested clean native build: `033b1c1`, SHA-256 `72e48b09cd44b916dc9a0734daef3358d44eb219052011b5726731ffbfc0183f`. This includes real native PWA installability, Secure cookies, WSS, restart/login/reboot and no-storage/offline checks behind each guest firewall. All guests shut down; production routing/daemon/authorization remained unchanged.

On 2026-10-16, all **14 scenarios passed on each of the three OS/firewall combinations** (42 integration scenario results), with **22 fast harness tests** and clean project Pyright checks. Native executable: revision `b374b65`, SHA-256 `69ba2641fbed6ad798ca3a85c057b0ee16731ffc8f706e206d0774be8ecf1921`. Guests were shut down; the existing host daemon and networking were not changed.
