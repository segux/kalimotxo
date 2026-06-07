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

## Components downloaded at runtime

Kalimotxo does **not** redistribute these binaries; it downloads them into the
user's folder (`~/.kalimotxo` / `~/.macbattlenet`) on first run. Each one keeps
its own license:

| Component | Use | License |
|-----------|-----|---------|
| [Wine](https://www.winehq.org/) (Staging / CrossOver builds) | Win32 compatibility layer | LGPL-2.1 |
| [DXMT](https://github.com/3Shain/dxmt) | Direct3D 11 → Metal | See repository |
| [MoltenVK](https://github.com/KhronosGroup/MoltenVK) | Vulkan → Metal | Apache-2.0 |
| [GnuTLS](https://www.gnutls.org/) | TLS (shipped inside the Wine builds) | LGPL-2.1+ |
| **Apple Game Porting Toolkit / D3DMetal** | Direct3D → Metal (DX12 games) | **Apple license — redistribution restricted** |

> **Important:** the Game Porting Toolkit and D3DMetal are subject to Apple's
> software license and are **not** included in this repository or in the published
> binaries. The user obtains them through the tool.

## Trademarks

"Battle.net", "Diablo", "Blizzard" and related logos are registered trademarks of
Blizzard Entertainment, Inc. Kalimotxo is an independent project with no
affiliation with or endorsement by Blizzard Entertainment or Apple Inc.
