#!/bin/sh
# Whistle runs as a per-user service, so the package installs only the program.
# Nothing here starts, restarts or configures a service for any user.
cat <<'MESSAGE'
Whistle is installed as /usr/bin/whistle.

Set it up as your regular user (not root):
  whistle install --host "$(tailscale ip -4)" --now
  whistle pair

Already set up? Run "whistle restart" to start using this version.
MESSAGE
