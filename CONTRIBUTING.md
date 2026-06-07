# Contributing to Kalimotxo

Thanks for your interest. This guide summarizes how to work on the project.

## Requirements

- macOS on Apple Silicon, Node.js ≥ 22 and **pnpm** ≥ 9.

## Package manager: pnpm

The repository uses **pnpm exclusively** — never `npm`, `npx` or `yarn`.

- Install: `pnpm install`
- Run one-off binaries: `pnpm dlx <pkg>`
- Add packages: `pnpm add <pkg>` / `pnpm add -D <pkg>`
- Do not create or commit `package-lock.json` or `yarn.lock`. Keep
  `pnpm-lock.yaml` up to date.

## Project rules

- **Language: English.** All code, identifiers, comments and log/user-facing
  strings must be written in English. (UI copy is handled via i18n locale files.)
- **Commits: Conventional Commits**, in English, e.g. `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`, `test:`. Optionally use [Commitizen](https://commitizen-tools.github.io/commitizen/)
  (`pnpm dlx cz`). A `commitlint.config.js` is provided; install the hooks with:

  ```bash
  pnpm add -D @commitlint/cli @commitlint/config-conventional husky
  pnpm exec husky init
  echo 'pnpm exec commitlint --edit "$1"' > .husky/commit-msg
  ```

- Style: no semicolons, single quotes, 2-space indentation (see `.editorconfig`
  and `.prettierrc`).

## Commands

| Task | Command |
|------|---------|
| Run in dev | `pnpm start` |
| Typecheck | `pnpm run codecheck` |
| Tests | `pnpm run test` |
| Battle.net tests | `pnpm run test:battlenet` |
| Build | `pnpm run build` |
| Package `.app` | `pnpm run dist:mac` |

Before opening a PR, always validate with `pnpm run codecheck` and `pnpm run test`.

## Layout

- `src/backend/` — main process (IPC, Wine, Battle.net).
  - `wine/wineEnv.ts` — Wine launch environment.
  - `wine/compatibilityLayers.ts` — active Wine selection.
  - `storeManagers/battlenet/service.ts` — install / repair / launch.
  - `config/paths.ts` — runtime paths.
- `src/frontend/` — React + Tailwind.
- `src/common/types/` — shared IPC contracts.

The status of the Battle.net work (known issues and root causes) lives in
[`docs/battlenet-wine-problemas-y-roadmap.md`](docs/battlenet-wine-problemas-y-roadmap.md).
If you change the default Wine runtime, update that document and
[`docs/QA-BATTLENET.md`](docs/QA-BATTLENET.md).

## Notes

- Apple Silicon: detect with `process.arch === 'arm64'`; x86 components run via Rosetta.
