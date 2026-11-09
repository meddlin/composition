#!/usr/bin/env bash
# Runs a command inside a private session bus with an Xvfb display and the AT-SPI bus: `xvfb-run.sh cmd args...`.
# What this shows is a GTK app on a bare X server with software GL: no compositor, no GNOME Shell, no real input method
# or screen reader. See apps/linux/spikes/README.md for what that can and cannot prove.
set -euo pipefail
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export DISPLAY="${DISPLAY:-:99}"
Xvfb "$DISPLAY" -screen 0 "${XVFB_SIZE:-1400x900x24}" +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
for _ in $(seq 60); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done
exec dbus-run-session -- bash -c '/usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/atspi.log 2>&1 & sleep 0.6; exec "$@"' _ "$@"
