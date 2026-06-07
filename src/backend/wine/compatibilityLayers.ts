import { existsSync, readdirSync, readFileSync } from 'fs'
import { MAIN_EXE_REL_PATHS } from '../storeManagers/battlenet/constants'
import { homedir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { loadGlobalConfig, saveGlobalConfig } from '../config/paths'
import { findWine64 } from '../setup/runtime'
import { findRelease, getActiveVersionId } from './manager/catalog'
import type { KalimotxoWineSettings, WineInstallation, WineLayerPreference } from './types'

export const CROSSOVER_BOTTLES_DIR = join(
  homedir(),
  'Library/Application Support/CrossOver/Bottles'
)
/** @deprecated use CROSSOVER_BOTTLES_DIR */
const CROSSOVER_BOTTLES = CROSSOVER_BOTTLES_DIR

/** Stop using CrossOver as the engine; use only the bundled Wine in ~/.kalimotxo. */
export function migrateWineSettingsToKalimotxo(): void {
  const cfg = loadGlobalConfig()
  if (cfg.wineLayer === 'auto' || cfg.wineLayer === 'crossover') {
    cfg.wineLayer = 'runtime'
    saveGlobalConfig(cfg)
  }
}

export function getWineSettings(): KalimotxoWineSettings {
  const cfg = loadGlobalConfig()
  let wineLayer = (cfg.wineLayer as WineLayerPreference) ?? 'runtime'
  if (wineLayer === 'auto' || wineLayer === 'crossover') {
    wineLayer = 'runtime'
  }
  const crossoverBottle =
    typeof cfg.crossoverBottle === 'string' && cfg.crossoverBottle.trim()
      ? cfg.crossoverBottle.trim()
      : 'Battle.net'
  return { wineLayer, crossoverBottle }
}

function wineExecs(wineBin: string): Pick<WineInstallation, 'bin' | 'wineserver'> {
  const wineserver = wineBin.replace(/wine64?$/, 'wineserver')
  return {
    bin: wineBin.replace(/wine64$/, 'wine'),
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

/**
 * CrossOver installs two wine binaries:
 * 1. bin/wine — a Perl launcher script that sets up the full environment
 * 2. lib/wine/x86_64-unix/wine — the actual Wine binary with 8000+ CodeWeavers patches
 *
 * For Kalimotxo we want the real binary (path #2) because we build our own env in
 * wineEnv.ts, but the real binary has the anti-cheat / D3DMetal / macdrv fixes.
 */
export function getCrossoverInstallations(): WineInstallation[] {
  if (process.platform !== 'darwin') return []
  const out: WineInstallation[] = []
  try {
    const stdout = execSync(
      'mdfind \'kMDItemCFBundleIdentifier = "com.codeweavers.CrossOver"\'',
      { encoding: 'utf-8', timeout: 8000 }
    )
    for (const appPath of stdout.split('\n').filter(Boolean)) {
      // Prefer the real patched binary over the Perl launcher script
      const realWineBin = join(
        appPath,
        'Contents/SharedSupport/CrossOver/lib/wine/x86_64-unix/wine'
      )
      const fallbackWineBin = join(
        appPath,
        'Contents/SharedSupport/CrossOver/bin/wine'
      )
      const wineBin = existsSync(realWineBin) ? realWineBin : fallbackWineBin
      if (!existsSync(wineBin)) continue
      let version = ''
      const plist = join(appPath, 'Contents/Info.plist')
      if (existsSync(plist)) {
        const m = readFileSync(plist, 'utf-8').match(
          /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
        )
        version = m?.[1] ?? ''
      }
      // Use wineserver from the same location as the binary
      const supportDir = join(appPath, 'Contents/SharedSupport/CrossOver')
      const wineserver = wineBin.includes('/lib/wine/')
        ? join(supportDir, 'lib/wine/../../bin/wineserver')
        : join(supportDir, 'bin/wineserver')
      out.push({
        bin: wineBin,
        wineserver: existsSync(wineserver) ? wineserver : undefined,
        name: version ? `CrossOver ${version}` : 'CrossOver',
        type: 'crossover'
      })
    }
  } catch {
    /* CrossOver no instalado */
  }
  return out
}

export function crossoverBottleExists(bottleName: string): boolean {
  return existsSync(join(CROSSOVER_BOTTLES, bottleName, 'cxbottle.conf'))
}

export function listDetectedWineInstallations(): WineInstallation[] {
  const list: WineInstallation[] = []
  const runtime = getRuntimeWineInstallation()
  if (runtime) list.push(runtime)
  list.push(...getCrossoverInstallations())
  return list
}

/**
 * Resolves the best Wine installation for Battle.net.
 * Prefers CrossOver if installed because it includes anti-cheat/D3DMetal patches.
 */
export function resolveBattleNetWineInstallation(): WineInstallation {
  // 1. Prefer CrossOver (has 8000+ patches for anti-cheat, macdrv, etc.)
  const crossover = getCrossoverInstallations()
  if (crossover.length > 0) {
    return crossover[0]
  }

  // 2. Fallback to Kalimotxo's bundled Wine runtime
  const runtime = getRuntimeWineInstallation()
  if (runtime) return runtime

  throw new Error(
    'Kalimotxo Wine is not ready. Click "Start" in Battle.net or complete the download in Settings.'
  )
}

function crossoverHasBattleNetClient(bottleName: string): boolean {
  const driveC = join(CROSSOVER_BOTTLES_DIR, bottleName, 'drive_c')
  return MAIN_EXE_REL_PATHS.some((rel) => existsSync(join(driveC, rel)))
}

/** CrossOver bottle that contains the Battle.net client (e.g. "Battle.net Desktop App-2"). */
export function findCrossoverBattleNetBottle(): string | undefined {
  const { crossoverBottle } = getWineSettings()
  if (crossoverBottleExists(crossoverBottle) && crossoverHasBattleNetClient(crossoverBottle)) {
    return crossoverBottle
  }
  for (const name of listCrossoverBottleNames()) {
    if (!/battle\.net/i.test(name)) continue
    if (crossoverHasBattleNetClient(name)) return name
  }
  return undefined
}

/** Legacy reference only; Kalimotxo does not use CrossOver bottles by default. */
export function resolveCrossoverBottleName(): string | undefined {
  return undefined
}

export function listCrossoverBottleNames(): string[] {
  if (!existsSync(CROSSOVER_BOTTLES)) return []
  try {
    return readdirSync(CROSSOVER_BOTTLES).filter((name) =>
      crossoverBottleExists(name)
    )
  } catch {
    return []
  }
}

export type CrossoverBottleInfo = {
  name: string
  hasBattleNetClient: boolean
}

export function listCrossoverBottleInfos(): CrossoverBottleInfo[] {
  return listCrossoverBottleNames()
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      hasBattleNetClient: crossoverHasBattleNetClient(name)
    }))
}
