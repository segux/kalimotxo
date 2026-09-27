import { existsSync } from 'fs'

import { logInfo } from '../../logger'
import { findRelease, getActiveVersionId, loadCatalog } from './catalog'
import { installWineVersionSync, refreshWineReleases, setActiveWineVersion } from './manager'

export const BATTLENET_WINE_TYPE = 'Wine-BattleNet'
const LATEST = `${BATTLENET_WINE_TYPE}-latest`

function isUsable(version: string | null): boolean {
  const release = version ? findRelease(version) : null
  return Boolean(
    release?.is_installed && release.type === BATTLENET_WINE_TYPE && existsSync(release.install_dir)
  )
}

/**
 * Battle.net only runs on a CrossOver-based Wine. Makes one active: keeps the
 * active one if it already is, else activates an installed one, else downloads
 * the latest build published by Kalimotxo's CI (docs/wine-build.md).
 * Returns false when none could be made available; callers keep the active Wine.
 */
export async function ensureBattleNetReadyWine(
  log: (m: string) => void = logInfo,
  onProgress?: (pct: number, msg: string) => void
): Promise<boolean> {
  if (isUsable(getActiveVersionId())) return true

  const installed = loadCatalog().find((r) => isUsable(r.version))
  if (installed) {
    setActiveWineVersion(installed.version)
    log(`Active Wine: ${installed.version}`)
    return true
  }

  log('Downloading Kalimotxo Wine...')
  await refreshWineReleases(['wine-battlenet'])
  if (!findRelease(LATEST)?.download) {
    log('No Battle.net Wine release is available yet')
    return false
  }
  const result = await installWineVersionSync(LATEST, { onProgress })
  if (!result.success) {
    log(`Could not install the Battle.net Wine: ${result.message}`)
    return false
  }
  setActiveWineVersion(LATEST)
  log(`Active Wine: ${LATEST}`)
  return true
}
