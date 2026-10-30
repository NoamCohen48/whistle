#!/bin/sh
# Install or upgrade Whistle for the current user, without root.
#
#   curl -fsSL https://github.com/__REPOSITORY__/releases/latest/download/install.sh | sh
#
# Arguments are passed to "whistle install", for example:
#   ... | sh -s -- --host 100.101.102.103 --port 8790
# Without --host, the PC's Tailscale IPv4 address is used when Tailscale is running.
set -eu

repository='__REPOSITORY__'
version='__VERSION__'

fail() { printf 'whistle install: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail 'Whistle runs on Linux PCs.'
[ "$(id -u)" != 0 ] || fail 'run this as your regular user, not root.'
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required for the background service.'
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "no build for $(uname -m); build from source instead." ;;
esac

if command -v curl >/dev/null 2>&1; then download() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then download() { wget -q --https-only -O "$2" "$1"; }
else fail 'curl or wget is required.'; fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT INT TERM
base="https://github.com/$repository/releases/download/v$version"
binary="whistle-linux-$arch"

printf 'Downloading Whistle %s for linux-%s...\n' "$version" "$arch"
download "$base/$binary" "$temporary/$binary" || fail "could not download $base/$binary"
download "$base/SHA256SUMS" "$temporary/SHA256SUMS" || fail 'could not download SHA256SUMS'
(cd "$temporary" && grep " $binary\$" SHA256SUMS | sha256sum -c --quiet -) || fail 'checksum mismatch; nothing was installed.'
chmod 755 "$temporary/$binary"

has_host=false
for argument in "$@"; do case "$argument" in --host | --host=*) has_host=true ;; esac; done
if [ "$has_host" = false ] && [ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/whistle/config.json" ]; then
  if address=$(tailscale ip -4 2>/dev/null | head -n 1) && [ -n "$address" ]; then
    set -- --host "$address" "$@"
  else
    printf 'Tailscale is not running, so Whistle will listen on 127.0.0.1 only.\n'
    printf 'Rerun with --host <address> to reach it from your phone.\n'
  fi
fi

if systemctl --user is-active --quiet whistle.service 2>/dev/null; then
  "$temporary/$binary" install "$@"
  systemctl --user restart whistle.service
  printf '\nWhistle %s is running. Your paired phones stay paired.\n' "$version"
else
  "$temporary/$binary" install --now "$@"
  printf '\nWhistle %s is running. Pair your phone:\n  whistle pair\n' "$version"
fi

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) printf '\nAdd ~/.local/bin to your PATH to use the whistle command.\n' ;;
esac
