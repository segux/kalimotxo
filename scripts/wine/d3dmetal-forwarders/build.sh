#!/usr/bin/env bash
# Rebuilds the two tiny forwarder DLLs used by `d3dmetalDx12.ts` to run a
# single DX12 game (Diablo II: Resurrected) through Apple's real D3DMetal.
#
# These are our own code — plain PE files whose entire export table forwards
# to `<name>_d3dmetal.dll` (the renamed GPTK DLLs Kalimotxo installs into the
# active Wine). No Apple content, no Wine code, just a name-forwarding shim.
# Only needs rebuilding if the export list changes (see the .def files, taken
# from GPTK's own d3d12.dll/dxgi.dll — `llvm-objdump -p <dll>`, Export Table).
#
# Requires llvm-mingw (same toolchain the Wine build CI uses):
#   https://github.com/mstorsjo/llvm-mingw
set -euo pipefail
cd "$(dirname "$0")"

CC=x86_64-w64-mingw32-clang
command -v "$CC" >/dev/null || { echo "llvm-mingw's $CC not on PATH" >&2; exit 1; }

for name in d3d12 dxgi; do
  "$CC" -shared -O2 -o "../../../resources/bundled/d3dmetal-forwarders/${name}.dll" \
    dllmain.c "${name}.def" \
    -nostartfiles -Wl,--entry,DllMain -nostdlib -lkernel32
  echo "built ${name}.dll"
done
