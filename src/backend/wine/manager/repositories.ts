/** Kalimotxo's own Wine build (see docs/wine-build.md). */
export const KALIMOTXO_WINE_REPO_ID = 'kalimotxo-wine'
export const KALIMOTXO_WINE_TYPE = 'Kalimotxo-Wine'
/** Release tag prefix of those builds in this repo, e.g. `wine-cx-26.1.0`. */
export const KALIMOTXO_WINE_TAG_PREFIX = 'wine-cx-'
/**
 * Type of CrossOver-based runtimes installed before Kalimotxo Wine existed
 * (hand-copied `Wine-BattleNet-11.0`, early `Wine-BattleNet-latest`).
 */
export const LEGACY_BATTLENET_WINE_TYPE = 'Wine-BattleNet'

export type WineRepoId =
  | 'wine-staging-macos'
  | 'game-porting-toolkit'
  | typeof KALIMOTXO_WINE_REPO_ID

export interface WineRepository {
  id: WineRepoId
  name: string
  typeLabel: string
  apiUrl: string
  installCategory: 'wine' | 'game-porting-toolkit'
}

/** Wine sources for the Wine manager. Kalimotxo's own build comes first. */
export const MACOS_REPOSITORIES: WineRepository[] = [
  {
    // "Battle.net ready" runtime: Wine built by Kalimotxo's CI from CodeWeavers'
    // CrossOver LGPL sources (WRITECOPY, msync, CEF fixes), published as
    // `wine-cx-<version>` releases of this repo. See docs/wine-build.md.
    id: KALIMOTXO_WINE_REPO_ID,
    name: 'Kalimotxo Wine',
    typeLabel: KALIMOTXO_WINE_TYPE,
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
