# [0.3.0](https://github.com/segux/kalimotxo/compare/v0.2.1...v0.3.0) (2026-09-26)


### Bug Fixes

* **battlenet:** keep the session alive and start the client faster ([752b72a](https://github.com/segux/kalimotxo/commit/752b72a80e8063c8b94c8639a9b515b86bac9f22))
* **ci:** bundle Wine's runtime dylibs next to its unix modules ([8e491c7](https://github.com/segux/kalimotxo/commit/8e491c753acfe29f947b7e83ce57bcee3b160ae1))
* **ci:** use the /usr/bin clang shims so host code gets the macOS SDK ([552649b](https://github.com/segux/kalimotxo/commit/552649b65b6791a50c81cd1cc683d07f022e87bd))
* **ci:** use Xcode clang for macOS code in the Wine build ([2061d42](https://github.com/segux/kalimotxo/commit/2061d42dc7d8c4df057d815a54fc095d93b86c4e))
* **wine:** resolve wineserver correctly and stop only the target prefix ([0ae8e4f](https://github.com/segux/kalimotxo/commit/0ae8e4f27ee3425f8fb9e1e57030e578165af41d))


### Features

* **library:** install and play Windows games outside Battle.net ([4b8e99c](https://github.com/segux/kalimotxo/commit/4b8e99c7221e9c0d6ae9f5250ffe44fec5c066e9))
* **wine:** download the Battle.net Wine built by Kalimotxo's CI ([b6ad2ae](https://github.com/segux/kalimotxo/commit/b6ad2ae44fdf0e14279ac68a26e08c7a8fa0a3dd))

## [0.2.1](https://github.com/segux/kalimotxo/compare/v0.2.0...v0.2.1) (2026-06-12)


### Bug Fixes

* disable mf/winegstreamer completely (empty override) to prevent crash dialog ([02ac630](https://github.com/segux/kalimotxo/commit/02ac630d95496b8dc9ecd665e7fe4bacca7c6241))

# 0.2.0 (2026-06-10)

First public release. Releases briefly published as 0.0.1, 1.0.0 and 1.1.0 while
the release pipeline was being fixed were withdrawn; their changes are listed here.


### Bug Fixes

* add release automation and update repo URL to segux/kalimotxo ([712b3b8](https://github.com/segux/kalimotxo/commit/712b3b85542b777e0c34f9eec0ffcf4fc2f29dca))
* Battle.net launch resolution + D2R online connectivity ([4ea5052](https://github.com/segux/kalimotxo/commit/4ea5052d922c52ccf56df58a49604b5c7b789c87))
* **ci:** add missing fi in bootstrap step ([cce8b24](https://github.com/segux/kalimotxo/commit/cce8b24f39d9a1e52c13e3f732502481df739bdf))
* **ci:** add workflows permission + make bootstrap idempotent ([220d294](https://github.com/segux/kalimotxo/commit/220d2946dcf12741dc79644a464316f1fb479b1f))
* **ci:** add workflows permission to allow tag push with workflow files ([0095fe3](https://github.com/segux/kalimotxo/commit/0095fe32144c23731fb792a899099011bfefd576))
* **ci:** delete local v0.0.0 tag before semantic-release push ([5063ff6](https://github.com/segux/kalimotxo/commit/5063ff62f6fefed3c7ff2131c174c53579930960))
* **ci:** disable husky hooks in release workflow (gitleaks not on CI) ([2bba6bc](https://github.com/segux/kalimotxo/commit/2bba6bc530881380caf7de87eb6393729b6ed74f))
* **ci:** fix Electron binary not installed in CI test runs ([3d43fb5](https://github.com/segux/kalimotxo/commit/3d43fb556b67f02dcc480d350b0dd7631a2dfe11))
* **ci:** fix git credentials for tag push in release workflow ([0fac6c3](https://github.com/segux/kalimotxo/commit/0fac6c35b75a7ac7d4c96ac086df23e9942383e6))
* **ci:** remove invalid workflows permission from release.yml ([58f201c](https://github.com/segux/kalimotxo/commit/58f201ca20ea6032776fe7e7c9030cf33ead4b62))
* **ci:** use persist-credentials for git push permissions ([c3e0f89](https://github.com/segux/kalimotxo/commit/c3e0f8981e875603d5770b0ef46667d072ad8ef7))
* harden game launch for fresh installs and improve error UX ([5a18298](https://github.com/segux/kalimotxo/commit/5a182985ff7da79b4d8c1d0ad8742eced2fdf165))
* launch Diablo II Resurrected with DXMT on Wine-BattleNet-11.0 ([3bce49c](https://github.com/segux/kalimotxo/commit/3bce49c1a38055c29e3bd94cf57ffc1bcdd5ccee))
* prevent game watcher from killing Kalimotxo-launched game processes ([455a769](https://github.com/segux/kalimotxo/commit/455a76914186ec793f8b44f29b7a1ba894198ac7))


### Features

* DMG installer background with Kalimotxo logo ([f951576](https://github.com/segux/kalimotxo/commit/f951576371a33be624140843aabd2d94b081d81f))
* production packaging + CI/CD pipeline for macOS ([576c83e](https://github.com/segux/kalimotxo/commit/576c83ecd3cdb60b0ca74fa1910c5623ecfb5e21))
* rebrand tagline to 'Windows gaming on Apple Silicon' ([baee71f](https://github.com/segux/kalimotxo/commit/baee71f3b04776d1ca9a38a8866ca7892e68ffb8))
* Wine manager for Battle.net on Apple Silicon ([7993e16](https://github.com/segux/kalimotxo/commit/7993e16195b998ccaa423040d58161241eafc63f))
