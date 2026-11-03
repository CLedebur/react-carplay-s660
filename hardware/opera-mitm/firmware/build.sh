#!/bin/bash
# Build on the Pi (toolchain + pico-sdk live there; see BUILD_NOTES §30.7) and optionally flash.
#   ./build.sh          build → build/opera_mitm.uf2
#   ./build.sh flash    build, then reboot the Pico into BOOTSEL over USB and load it
set -euo pipefail
cd "$(dirname "$0")"
export PICO_SDK_PATH="${PICO_SDK_PATH:-$HOME/src/pico-sdk}"
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
ninja -C build
ls -l build/opera_mitm.uf2
if [ "${1:-}" = "flash" ]; then
    # A running firmware takes the line "bootsel" on its console to reboot into BOOTSEL (firmware
    # before 2026-11-03 took 'b', the first character of it). Echo off first: the console must never
    # hear its own log text back. The first time, or if it is hung, hold the Pico's BOOTSEL button
    # and tap the board's reset (SW2) instead.
    CON=$(ls /dev/serial/by-id/usb-S660_CarPlay_OPERA_MITM_*-if00 2>/dev/null | head -1)
    if [ -c "$CON" ]; then stty -F "$CON" raw -echo; printf 'bootsel\n' > "$CON"; sleep 3; fi
    picotool load -v -x build/opera_mitm.uf2
fi
