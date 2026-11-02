#!/usr/bin/env bash
# Build the CANable 2.0 slcan firmware with the S660 silent-mode patch.
#
# Upstream is pinned to b158aa7, the build Makerbase ships on the MKS
# CANable V2.0 (Pro). Runs on any Debian / Raspberry Pi OS host that has:
#   sudo apt install git make gcc-arm-none-eabi
# Output: build/canable2-<version>.bin next to this script.
set -euo pipefail

UPSTREAM=https://github.com/normaldotcom/canable2-fw.git
COMMIT=b158aa7
VERSION=b158aa7-s660.1
REMOTE=github.com/CLedebur/react-carplay-s660

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone -q "$UPSTREAM" "$WORK/src"
git -C "$WORK/src" checkout -q "$COMMIT"
git -C "$WORK/src" apply "$HERE/s660-silent-mode.patch"

# VERSION/REMOTE end up in the USB product string and the V reply.
make -C "$WORK/src" -j"$(nproc)" GIT_VERSION="$VERSION" GIT_REMOTE="$REMOTE"

mkdir -p "$HERE/build"
cp "$WORK/src/build/canable2-$VERSION.bin" "$HERE/build/"
sha256sum "$HERE/build/canable2-$VERSION.bin"
