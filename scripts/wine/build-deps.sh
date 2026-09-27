#!/bin/bash
# Build the x86_64 libraries Wine loads at runtime (gnutls, freetype, SDL2) from
# source, plus the official MoltenVK binary, into one prefix.
#
# Homebrew no longer installs on x86_64 macOS nor publishes Intel bottles, so
# on an Apple Silicon runner these are compiled here (clang -arch x86_64). Only
# linked libraries need to be x86_64; build tools (bison, pkgconf, cmake) come
# from the native Homebrew.
#
# Usage: build-deps.sh <prefix>
# Kept compatible with macOS's bash 3.2.

set -euo pipefail

PREFIX="$1"
WORK="${WORK_DIR:-$(mktemp -d)}"
JOBS="$(sysctl -n hw.ncpu)"

GMP_VERSION=6.3.0
NETTLE_VERSION=3.10.2
GNUTLS_VERSION=3.8.9
FREETYPE_VERSION=2.13.3
SDL2_VERSION=2.32.10
# 1.2.11: Battle.net's CEF (ANGLE on Vulkan) aborts on 1.3.x, which rejects the
# external memory type winevulkan requests (vkCreateBuffer: only MTLBUFFER/MTLHEAP
# handle types). Khronos publishes the 1.2.11 binaries under this tag.
MOLTENVK_VERSION="${MOLTENVK_VERSION:-v1.2.11-artifacts}"

export MACOSX_DEPLOYMENT_TARGET=11.0
# The /usr/bin driver shims pick the active Xcode and its macOS SDK. Plain
# `clang` could resolve to llvm-mingw's (on PATH for Wine), which has no SDK.
export SDKROOT="${SDKROOT:-$(xcrun --show-sdk-path)}"
CLANG=/usr/bin/clang
CLANGXX=/usr/bin/clang++
export CC="$CLANG -arch x86_64"
export CXX="$CLANGXX -arch x86_64"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
HOST=x86_64-apple-darwin

mkdir -p "$PREFIX" "$WORK"
cd "$WORK"

fetch() {
  local url="$1" dir="$2"
  curl -fsSL -A "Mozilla/5.0" "$url" -o "$dir.tar"
  mkdir -p "$dir"
  tar -xf "$dir.tar" -C "$dir" --strip-components=1
}

autotools() {
  local dir="$1"
  shift
  (cd "$dir" && arch -x86_64 ./configure --prefix="$PREFIX" --host="$HOST" \
    --enable-shared --disable-static "$@" && arch -x86_64 make -j"$JOBS" && make install)
}

echo "==> gmp $GMP_VERSION"
fetch "https://ftp.gnu.org/gnu/gmp/gmp-$GMP_VERSION.tar.xz" gmp
autotools gmp --disable-assembly

echo "==> nettle $NETTLE_VERSION"
fetch "https://ftp.gnu.org/gnu/nettle/nettle-$NETTLE_VERSION.tar.gz" nettle
autotools nettle --disable-documentation --disable-fat \
  --with-include-path="$PREFIX/include" --with-lib-path="$PREFIX/lib"

echo "==> gnutls $GNUTLS_VERSION"
fetch "https://www.gnupg.org/ftp/gcrypt/gnutls/v${GNUTLS_VERSION%.*}/gnutls-$GNUTLS_VERSION.tar.xz" gnutls
autotools gnutls \
  --with-included-libtasn1 --with-included-unistring \
  --without-p11-kit --without-idn --without-zstd --without-brotli \
  --without-tpm --without-tpm2 \
  --disable-doc --disable-tests --disable-tools --disable-cxx --disable-nls --disable-guile

echo "==> freetype $FREETYPE_VERSION"
fetch "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE_VERSION.tar.xz" freetype
autotools freetype --with-harfbuzz=no --with-brotli=no --with-png=no --with-bzip2=no

echo "==> SDL2 $SDL2_VERSION"
fetch "https://github.com/libsdl-org/SDL/releases/download/release-$SDL2_VERSION/SDL2-$SDL2_VERSION.tar.gz" sdl2
cmake -S sdl2 -B sdl2/build -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$CLANG" -DCMAKE_CXX_COMPILER="$CLANGXX" \
  -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DSDL_SHARED=ON -DSDL_STATIC=OFF -DSDL_TEST=OFF
cmake --build sdl2/build -j"$JOBS"
cmake --install sdl2/build

echo "==> MoltenVK $MOLTENVK_VERSION"
curl -fsSL "https://github.com/KhronosGroup/MoltenVK/releases/download/$MOLTENVK_VERSION/MoltenVK-macos.tar" -o moltenvk.tar
mkdir -p moltenvk && tar -xf moltenvk.tar -C moltenvk
MVK_DYLIB="$(find moltenvk -path '*dynamic*' -name libMoltenVK.dylib -print -quit)"
test -n "$MVK_DYLIB"
cp "$MVK_DYLIB" "$PREFIX/lib/"
MVK_INCLUDE="$(find moltenvk -type d -name include -path '*MoltenVK*' -print -quit)"
if [ -n "$MVK_INCLUDE" ]; then cp -R "$MVK_INCLUDE/." "$PREFIX/include/"; fi

echo "==> check architectures"
for lib in libgnutls.30.dylib libfreetype.6.dylib libSDL2-2.0.0.dylib libMoltenVK.dylib; do
  lipo -archs "$PREFIX/lib/$lib" | tee /dev/stderr | grep -q x86_64
done
