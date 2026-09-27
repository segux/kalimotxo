import { existsSync } from 'fs'

import { logInfo } from '../../logger'
import { findRelease, getActiveVersionId, loadCatalog, saveCatalog, setActiveVersionId } from './catalog'
import { installWineVersionSync, refreshWineReleases, setActiveWineVersion } from './manager'
import { newestKalimotxoWine } from './releases'
import {
  KALIMOTXO_WINE_REPO_ID,
  KALIMOTXO_WINE_TAG_PREFIX,
  KALIMOTXO_WINE_TYPE,
  LEGACY_BATTLENET_WINE_TYPE
} from './repositories'
import type { WineRelease } from './types'

/** Battle.net runs on CrossOver-based Wine: Kalimotxo Wine or a legacy hand-installed one. */
function isBattleNetReadyType(type: string): boolean {
  return type === KALIMOTXO_WINE_TYPE || type === LEGACY_BATTLENET_WINE_TYPE
}

function isUsable(version: string | null): boolean {
  const release = version ? findRelease(version) : null
  return Boolean(
    release?.is_installed && isBattleNetReadyType(release.type) && existsSync(release.install_dir)
  )
}

/** `…/releases/download/wine-cx-26.1.0/…` -> `26.1.0` (null for other downloads). */
function versionFromDownload(url: string): string | null {
  const m = new RegExp(`/download/${KALIMOTXO_WINE_TAG_PREFIX}([^/]+)/`).exec(url)
  return m?.[1] ?? null
}

/**
 * Early builds were catalogued as `Wine-BattleNet-latest` / `Wine-BattleNet-CX-<ver>`.
 * Rename them to `Kalimotxo-Wine-<ver>` (keeping their install dir) and follow
 * the active version. Hand-installed legacy runtimes (no download URL) stay.
 */
export function migrateKalimotxoWineCatalog(): void {
  const catalog = loadCatalog()
  const active = getActiveVersionId()
  let newActive: string | null = null
  const byVersion = new Map<string, WineRelease>()
  let changed = false
  for (const release of catalog) {
    const ver =
      release.type === LEGACY_BATTLENET_WINE_TYPE ? versionFromDownload(release.download) : null
    if (!ver) {
      byVersion.set(release.version, release)
      continue
    }
    changed = true
    const version = `${KALIMOTXO_WINE_TYPE}-${ver}`
    const renamed: WineRelease = {
      ...release,
      version,
      type: KALIMOTXO_WINE_TYPE,
      repository_id: KALIMOTXO_WINE_REPO_ID
    }
    const existing = byVersion.get(version)
    // Two old aliases can map to one version: keep the installed one.
    if (!existing || (!existing.is_installed && renamed.is_installed)) byVersion.set(version, renamed)
    if (release.version === active) newActive = version
  }
  if (!changed) return
  saveCatalog([...byVersion.values()])
  if (newActive) setActiveVersionId(newActive)
  logInfo(`[wine] Catalog migrated to Kalimotxo Wine names${newActive ? ` (active: ${newActive})` : ''}`)
}

/**
 * Moves an active Kalimotxo Wine to a newer published build (e.g. a revision
 * that fixes Battle.net). Hand-installed runtimes are never replaced, and any
 * failure (offline, download) keeps the current one.
 */
async function upgradeKalimotxoWine(
  active: string,
  log: (m: string) => void,
  onProgress?: (pct: number, msg: string) => void
): Promise<void> {
  if (findRelease(active)?.type !== KALIMOTXO_WINE_TYPE) return
  try {
    const newest = newestKalimotxoWine(await refreshWineReleases([KALIMOTXO_WINE_REPO_ID]))
    if (!newest || newest.version.localeCompare(active, undefined, { numeric: true }) <= 0) return
    log(`Updating Kalimotxo Wine: ${active} -> ${newest.version}`)
    const result = await installWineVersionSync(newest.version, { onProgress })
    if (!result.success) {
      log(`Kalimotxo Wine update failed, keeping ${active}: ${result.message}`)
      return
    }
    setActiveWineVersion(newest.version)
    log(`Active Wine: ${newest.version}`)
  } catch (e) {
    log(`Kalimotxo Wine update skipped: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Battle.net only runs on a CrossOver-based Wine. Makes one active: keeps the
 * active one if it already is, else activates an installed one, else downloads
 * the newest Kalimotxo Wine published by this project's CI (docs/wine-build.md).
 * Returns false when none could be made available; callers keep the active Wine.
 */
export async function ensureBattleNetReadyWine(
  log: (m: string) => void = logInfo,
  onProgress?: (pct: number, msg: string) => void
): Promise<boolean> {
  const active = getActiveVersionId()
  if (isUsable(active)) {
    await upgradeKalimotxoWine(active!, log, onProgress)
    return true
  }

  const installed = loadCatalog().find((r) => isUsable(r.version))
  if (installed) {
    setActiveWineVersion(installed.version)
    log(`Active Wine: ${installed.version}`)
    return true
  }

  log('Downloading Kalimotxo Wine...')
  const newest = newestKalimotxoWine(await refreshWineReleases([KALIMOTXO_WINE_REPO_ID]))
  if (!newest) {
    log('No Kalimotxo Wine release is available yet')
    return false
  }
  const result = await installWineVersionSync(newest.version, { onProgress })
  if (!result.success) {
    log(`Could not install Kalimotxo Wine: ${result.message}`)
    return false
  }
  setActiveWineVersion(newest.version)
  log(`Active Wine: ${newest.version}`)
  return true
}
