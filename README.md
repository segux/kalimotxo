<div align="center">

# Kalimotxo

**Windows gaming on Apple Silicon**

Install and play Battle.net games on your Apple Silicon Mac — no technical knowledge required.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/segux/kalimotxo/releases)
[![Release](https://img.shields.io/github/v/release/segux/kalimotxo?label=latest)](https://github.com/segux/kalimotxo/releases/latest)

[**Download**](https://github.com/segux/kalimotxo/releases/latest) · [Report a bug](https://github.com/segux/kalimotxo/issues)

</div>

---

## What is Kalimotxo?

Kalimotxo is a free, open-source desktop app that makes it possible to run
Battle.net games on Apple Silicon Macs (M1, M2, M3, M4…). It sets up and manages
everything automatically: the Wine compatibility layer, the graphics drivers, and
the Battle.net client itself.

**You just click Install, and Kalimotxo takes care of the rest.**

> Tested and working on **macOS 16 Tahoe** on Apple Silicon.

---

## Requirements

| | |
|---|---|
| **Mac** | Apple Silicon (M1 or newer) |
| **macOS** | Ventura 13 or later — tested on Tahoe 16 |
| **Disk space** | ~2 GB free (for Wine + graphics runtimes) |
| **Internet** | Required for the initial setup download |

That's it. No Xcode, no command line — the setup wizard handles everything else. If an
optional component needs Homebrew (GStreamer for game audio, Apple's Game Porting Toolkit),
the wizard installs it for you; macOS may ask for your password once.

---

## Download and install

1. Go to the [Releases page](https://github.com/segux/kalimotxo/releases/latest).
2. Download **Kalimotxo-x.x.x-arm64.dmg**.
3. Open the DMG file and drag **Kalimotxo** into your **Applications** folder.
4. Launch Kalimotxo from Applications.

The DMG only contains the app. The Wine engine is a separate download that Kalimotxo
fetches by itself during setup (see below) — you never need to download it manually.
On the Releases page you will also see `wine-cx-…` releases: those are that engine,
published for Kalimotxo to download.

> **"Kalimotxo" can't be opened?** Right-click the app icon → **Open** → click Open
> in the dialog. You only need to do this once. This happens because the app is
> distributed outside the Mac App Store.

---

## First launch — setup wizard

The first time you open Kalimotxo it shows a setup wizard. Click
**"Prepare everything automatically"** and wait for it to finish.

The wizard downloads:
- **Kalimotxo Wine** — the compatibility layer for Windows programs. It is Wine built by
  this project's CI from the open-source code CodeWeavers publishes for CrossOver (LGPL),
  which is what Battle.net needs on Apple Silicon. About 80 MB, verified with its checksum.
  See [docs/wine-build.md](docs/wine-build.md).
- DXMT (translates DirectX 10/11 calls to Metal — Apple's GPU API)
- D3DMetal from Apple's Game Porting Toolkit, only needed for DirectX 12 games such as
  Diablo IV. Kalimotxo takes it from CrossOver or the Game Porting Toolkit if you have
  them, or installs Apple's toolkit through Homebrew.
- Rosetta 2 (if not already installed)

This is a one-time download of a few hundred MB, stored in `~/.kalimotxo`. Once done,
you're ready to install games. Wine updates are published separately from the app, so a
new Wine does not require a new Kalimotxo version (and vice versa).

---

## Installing and playing games

1. Open Kalimotxo and go to **Platforms → Battle.net**.
2. Click **Install** to download and set up the Battle.net client.
3. Log in to Battle.net normally inside the window.
4. Install any game from the Battle.net client.
5. To launch a game later, click **Play** next to it in Kalimotxo.

### Supported games (tested)

| Game | Status |
|---|---|
| Diablo II: Resurrected | ✅ Working |
| World of Warcraft | ✅ Working |
| Overwatch 2 | ✅ Working |
| Hearthstone | ✅ Working |
| StarCraft II | ✅ Working |
| Warcraft III: Reforged | ✅ Working |

Other Battle.net games may work — try them and [report results](https://github.com/segux/kalimotxo/issues).

### Other Windows games

Games that are not on Battle.net (for example from GOG or a game's own website) can be
added too, and they show up in your **Library** next to the Battle.net ones:

1. Go to **Library → Add game**.
2. Choose **Install from an installer** and pick the game's `.exe` or `.msi` setup, then
   complete the installer in its window. Or choose **Add an installed game** and pick
   the game's `.exe`.
3. After installing, pick the game's executable from the list (the likely one is
   preselected) and click **Add to library**.

These games live in their own Wine bottle ("Games"), separate from Battle.net. The first
time, Kalimotxo prepares it with Visual C++ and DirectX runtimes (under a minute). The
graphics layer is detected from the game (DirectX 12 → D3DMetal, 10/11 → DXMT, 9 and older
→ Wine); if a game does not start or looks wrong, try another one in its settings.

---

## Frequently asked questions

**Does it cost anything?**
No. Kalimotxo is free and open-source under the GPL-3.0 license. You still need
to own the games you want to play.

**Will it slow down my Mac or damage anything?**
No. Kalimotxo creates an isolated environment in `~/.kalimotxo`. Removing the app
and deleting that folder restores your Mac to its original state completely.

**Does it work on Intel Macs?**
No. It is built specifically for Apple Silicon (M-series chips).

**Why does macOS warn me the app is from an unidentified developer?**
The app is not signed with an Apple developer certificate (that costs $99/year).
Right-click → Open bypasses this warning and is safe.

**A game doesn't start or crashes — what do I do?**
Check the [issues page](https://github.com/segux/kalimotxo/issues) to see if it's
a known problem. If not, open a new issue with your Mac model, macOS version, and
the game name.

**Is the Wine Kalimotxo uses its own? Do I need CrossOver?**
You do not need CrossOver. Kalimotxo compiles its own Wine in this repository's CI from
the open-source code CodeWeavers publishes for CrossOver (LGPL), without modifications,
and publishes it as `wine-cx-…` releases with its licence and a copy of the source code.
Kalimotxo is not affiliated with CodeWeavers. Other Wine versions can be installed and
switched in **Settings → Wine**, but Battle.net needs the CrossOver-based one.

---

## Languages

The UI is available in **English, Spanish, French, Italian, Portuguese and German**.
Kalimotxo auto-detects your system language and you can change it in
**Settings → System**.

---

## For developers

This project uses **pnpm** exclusively (never npm or yarn).

```bash
pnpm install
pnpm start          # Electron dev window with hot reload
pnpm run codecheck  # TypeScript type check (no emit)
pnpm run test       # Jest test suite
pnpm run dist:mac   # Build Kalimotxo.app + DMG into dist/mac/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code conventions (English code,
Conventional Commits in English).

### Architecture overview

```
src/
  backend/          # Electron main process
    wine/           # Wine environment, runtimes, graphics layers
    storeManagers/  # Battle.net orchestration (install/repair/launch)
    config/         # Paths and global config
    launcher/       # Wine runner, registry setup
  preload/          # Typed window.api bridge
  frontend/         # React + Tailwind UI
  common/types/     # IPC contracts shared between processes
```

Key files:
- [`wine/wineEnv.ts`](src/backend/wine/wineEnv.ts) — builds the Wine launch environment
- [`wine/wineRuntimeLibs.ts`](src/backend/wine/wineRuntimeLibs.ts) — places MoltenVK and gnutls where Wine loads them
- [`storeManagers/battlenet/agentPortBridge.ts`](src/backend/storeManagers/battlenet/agentPortBridge.ts) — Update Agent TCP bridge (port 1120)
- [`storeManagers/battlenet/service.ts`](src/backend/storeManagers/battlenet/service.ts) — install / repair / launch orchestration

For a deep dive into the technical challenges solved, see [`docs/battlenet-wine-problemas-y-roadmap.md`](docs/battlenet-wine-problemas-y-roadmap.md).

---

## Credits

Kalimotxo builds on [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) (GPL-3.0),
[DXMT](https://github.com/3Shain/dxmt), [MoltenVK](https://github.com/KhronosGroup/MoltenVK) and Wine.
Full list in [CREDITS.md](CREDITS.md).

## License

[GPL-3.0-or-later](LICENSE).

## Disclaimer

Independent project, not affiliated with or endorsed by Blizzard Entertainment,
Apple Inc. or CodeWeavers, Inc. Trademarks belong to their respective owners. Use at your own risk and
respect the terms of service of the software you run.
