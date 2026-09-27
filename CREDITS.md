# Credits and third-party software

Kalimotxo would not be possible without the work of other projects. The Wine
manager and much of the compatibility flow are inspired by and derived from them.

## Derived code

- **[Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher)**
  — GPL-3.0. The Wine install management, the launch environment
  (`setupWineEnvVars`) and the runtime download/selection are based on its
  architecture. That is why Kalimotxo is also distributed under **GPL-3.0**.

- **[D4Mac](https://github.com/MichaelLod/D4Mac)** — reference for the
  Wine 11 + Game Porting Toolkit + DXMT stack that makes Battle.net and Diablo IV
  run on Apple Silicon.

- **[Silo](https://github.com/mikaelhug/Silo)** — LGPL-2.1. The CI recipe that
  builds Wine from CrossOver sources (`.github/workflows/build-wine.yml`) is
  adapted from its `build-wine.yml`.

## Kalimotxo Wine (distributed by this project)

The `wine-cx-<version>` releases of this repository are a Wine build made by
Kalimotxo's CI and downloaded by the app. They contain, unmodified:

| Component | Use | License |
|-----------|-----|---------|
| [Wine](https://www.winehq.org/) from [CodeWeavers' CrossOver sources](https://www.codeweavers.com/crossover/source) | Win32 compatibility layer | LGPL-2.1 |
| [GnuTLS](https://www.gnutls.org/), [Nettle](https://www.lysator.liu.se/~nisse/nettle/), [GMP](https://gmplib.org/) | TLS | LGPL |
| [FreeType](https://freetype.org/) | Fonts | FreeType License / GPL-2.0 |
| [SDL2](https://www.libsdl.org/) | Game controllers | zlib |
| [MoltenVK](https://github.com/KhronosGroup/MoltenVK) | Vulkan → Metal | Apache-2.0 |

Each release includes the licence and `SOURCE.md` with the exact source used;
the CrossOver source tarball is attached to the release. The Windows side is
cross-compiled with [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) (build
tool only, not distributed). See [docs/wine-build.md](docs/wine-build.md).

## Components downloaded at runtime

Kalimotxo does **not** redistribute these binaries; it downloads them into the
user's folder (`~/.kalimotxo`) when needed. Each one keeps its own license:

| Component | Use | License |
|-----------|-----|---------|
| Other [Wine](https://www.winehq.org/) builds (Staging, GPTK), optional | Win32 compatibility layer | LGPL-2.1 |
| [DXMT](https://github.com/3Shain/dxmt) | Direct3D 10/11 → Metal | See repository |
| **Apple Game Porting Toolkit / D3DMetal** | Direct3D → Metal (DX12 games) | **Apple license — redistribution restricted** |

> **Important:** the Game Porting Toolkit and D3DMetal are subject to Apple's
> software license and are **not** included in this repository or in the published
> binaries. The user obtains them through the tool.

## Trademarks

"Battle.net", "Diablo", "Blizzard" and related logos are registered trademarks of
Blizzard Entertainment, Inc. "CrossOver" is a trademark of CodeWeavers, Inc.
Kalimotxo is an independent project with no affiliation with or endorsement by
Blizzard Entertainment, Apple Inc. or CodeWeavers, Inc.
