export type WineRepoId =
  | 'wine-staging-macos'
  | 'wine-crossover'
  | 'game-porting-toolkit'
  | 'wine-battlenet'

export interface WineRepository {
  id: WineRepoId
  name: string
  typeLabel: string
  apiUrl: string
  installCategory: 'wine' | 'game-porting-toolkit'
}

/** Mismos repos que Heroic / kalimotxo Python. */
export const MACOS_REPOSITORIES: WineRepository[] = [
  {
    // "Battle.net ready" runtime: Wine built by Kalimotxo's CI from CodeWeavers'
    // CrossOver LGPL sources (WRITECOPY, msync, CEF fixes), published as
    // `wine-cx-<version>` releases of this repo. See docs/wine-build.md.
    id: 'wine-battlenet',
    name: 'Wine Battle.net (CrossOver)',
    typeLabel: 'Wine-BattleNet',
    apiUrl: 'https://api.github.com/repos/segux/kalimotxo/releases',
    installCategory: 'wine'
  },
  {
    id: 'wine-staging-macos',
    name: 'Wine Staging (macOS)',
    typeLabel: 'Wine-Staging-macOS',
    apiUrl: 'https://api.github.com/repos/Gcenx/macOS_Wine_builds/releases',
    installCategory: 'wine'
  },
  {
    id: 'wine-crossover',
    name: 'Wine Crossover',
    typeLabel: 'Wine-Crossover',
    apiUrl: 'https://api.github.com/repos/Heroic-Games-Launcher/wine-crossover/releases',
    installCategory: 'wine'
  },
  {
    id: 'game-porting-toolkit',
    name: 'Game Porting Toolkit',
    typeLabel: 'Game-Porting-Toolkit',
    apiUrl: 'https://api.github.com/repos/Gcenx/game-porting-toolkit/releases',
    installCategory: 'game-porting-toolkit'
  }
]

export const REPO_BY_ID = Object.fromEntries(
  MACOS_REPOSITORIES.map((r) => [r.id, r])
) as Record<WineRepoId, WineRepository>

export const REPO_BY_TYPE = Object.fromEntries(
  MACOS_REPOSITORIES.map((r) => [r.typeLabel, r])
) as Record<string, WineRepository>
