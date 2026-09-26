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
    picotool load -f -v -x build/opera_mitm.uf2
fi
