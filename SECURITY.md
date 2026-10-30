# Security

A phone paired with Whistle can type into your terminals with your user's permissions. Security reports are taken seriously.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/NoamCohen48/whistle/security/advisories/new). Please don't open a public issue. Include the version (`whistle version`), what an attacker needs (for example network access, or a paired phone), and how to reproduce it. You should get a reply within a week.

## Supported versions

Only the latest release receives security fixes.

## Intended deployment

Whistle is designed for one person's PC on a private network such as Tailscale:

- It listens only on an address you choose, and refuses wildcard addresses. With HTTPS it should listen only on `127.0.0.1` behind a private proxy such as Tailscale Serve.
- It must not be exposed to the public internet, for example with Tailscale Funnel or a port forward.
- Anyone who can scan a fresh QR code from your screen can pair. Codes work once and expire after five minutes.

Issues that require one of these to be broken first, such as a compromised Tailscale account or a public listener, are still welcome. They are treated as hardening rather than vulnerabilities.
