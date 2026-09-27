import { existsSync } from 'fs'
import { loadGlobalConfig, saveGlobalConfig } from '../config/paths'
import { findWine64 } from '../setup/runtime'
import { findRelease, getActiveVersionId } from './manager/catalog'
import type { WineInstallation } from './types'
import { wineserverSibling } from './wineserverPath'

/**
 * Kalimotxo only runs its own Wine runtimes (~/.kalimotxo/runtime/wine). Older
 * versions could use the CrossOver app as the engine; drop those settings.
 */
export function migrateWineSettingsToKalimotxo(): void {
  const cfg = loadGlobalConfig()
  if ('wineLayer' in cfg || 'crossoverBottle' in cfg) {
    delete cfg.wineLayer
    delete cfg.crossoverBottle
    saveGlobalConfig(cfg)
  }
}

function wineExecs(wineBin: string): Pick<WineInstallation, 'bin' | 'wineserver'> {
  // Some builds (e.g. GPTK) only ship wine64, no wine symlink.
  // When findWine64 returns wine64, converting to wine must not
  // produce a path that doesn't exist (spawn would fail with ENOENT).
  const binAsWine = wineBin.replace(/wine64$/, 'wine')
  const bin = binAsWine !== wineBin && existsSync(binAsWine) ? binAsWine : wineBin
  const wineserver = wineserverSibling(wineBin)
  return {
    bin,
    wineserver: existsSync(wineserver) ? wineserver : undefined
  }
}

export function getRuntimeWineInstallation(): WineInstallation | null {
  const wine64 = findWine64()
  if (!wine64) return null
  const versionId = getActiveVersionId()
  const release = versionId ? findRelease(versionId) : null
  const label = release?.version ?? 'Kalimotxo Wine'
  return {
    ...wineExecs(wine64),
    name: label,
    type: 'wine'
  }
}

export function listDetectedWineInstallations(): WineInstallation[] {
  const runtime = getRuntimeWineInstallation()
  return runtime ? [runtime] : []
}

/** The Wine installation used for Battle.net and games: Kalimotxo's active runtime. */
export function resolveBattleNetWineInstallation(): WineInstallation {
  const runtime = getRuntimeWineInstallation()
  if (runtime) return runtime

  throw new Error(
    'Kalimotxo Wine is not ready. Click "Start" in Battle.net or complete the download in Settings.'
  )
}
