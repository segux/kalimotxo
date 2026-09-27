import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, openSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { LOGS_DIR } from '../config/paths'

/**
 * Stopgap while D2R doesn't run through Kalimotxo's own Wine (see
 * docs/battlenet-wine-problemas-y-roadmap.md): D2R only speaks DirectX 12,
 * and Kalimotxo's own build — and Wine's own vkd3d, and vkd3d-proton, and
 * Apple's GPTK DLLs bolted onto Kalimotxo's Wine — all crash on this Mac
 * once real gameplay starts (a `vkAllocateDescriptorSets` assertion inside
 * Wine's own `winevulkan`, or a native mutex crash from an ABI mismatch
 * between Kalimotxo's Wine and GPTK's precompiled DLLs). CodeWeavers' own
 * CrossOver build does not hit either: verified end to end (login, Play,
 * in-game) against its own existing bottle.
 *
 * This does not try to run CrossOver's Wine against Kalimotxo's own bottle
 * (tried; a foreign Wine build hangs before `winemac.drv` even loads against
 * a bottle it did not create) or copy Kalimotxo's game install into it.
 * It opens Battle.net inside CrossOver's own, already-configured bottle,
 * through CrossOver's own `cxstart` — the two stay completely separate.
 */

const CROSSOVER_BOTTLES_DIR = join(homedir(), 'Library/Application Support/CrossOver/Bottles')

export interface CrossOverInstallation {
  appPath: string
  cxstart: string
  version: string
}

/** Finds an installed CrossOver.app via Spotlight (works wherever it was put). */
export function findCrossOverApp(): CrossOverInstallation | null {
  if (process.platform !== 'darwin') return null
  try {
    const stdout = execSync(
      'mdfind \'kMDItemCFBundleIdentifier = "com.codeweavers.CrossOver"\'',
      { encoding: 'utf-8', timeout: 8000 }
    )
    for (const appPath of stdout.split('\n').filter(Boolean)) {
      const cxstart = join(appPath, 'Contents/SharedSupport/CrossOver/bin/cxstart')
      if (!existsSync(cxstart)) continue
      let version = ''
      try {
        version = execSync(`"${cxstart}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim()
      } catch {
        /* keep empty */
      }
      return { appPath, cxstart, version }
    }
  } catch {
    /* CrossOver not installed, or mdfind unavailable */
  }
  return null
}

/** A CrossOver bottle (any name) that already has Battle.net installed. */
export function findCrossOverBattleNetBottle(): string | null {
  if (!existsSync(CROSSOVER_BOTTLES_DIR)) return null
  let names: string[]
  try {
    names = readdirSync(CROSSOVER_BOTTLES_DIR)
  } catch {
    return null
  }
  for (const name of names) {
    const exe = join(
      CROSSOVER_BOTTLES_DIR,
      name,
      'drive_c/Program Files (x86)/Battle.net/Battle.net.exe'
    )
    if (existsSync(exe)) return name
  }
  return null
}

/**
 * Opens Battle.net inside its CrossOver bottle. Log in and click Play from
 * there as usual — this is a separate install from Kalimotxo's own, with its
 * own login session and its own Diablo II: Resurrected copy.
 */
export function openBattleNetViaCrossOver(
  log?: (m: string) => void
): { success: boolean; message: string } {
  const cx = findCrossOverApp()
  if (!cx) {
    return { success: false, message: 'CrossOver is not installed.' }
  }
  const bottle = findCrossOverBattleNetBottle()
  if (!bottle) {
    return {
      success: false,
      message:
        'No CrossOver bottle with Battle.net was found. Install Battle.net in CrossOver first (Diablo II: Resurrected needs it there for now — see Settings).'
    }
  }
  const exe = join(
    CROSSOVER_BOTTLES_DIR,
    bottle,
    'drive_c/Program Files (x86)/Battle.net/Battle.net.exe'
  )
  mkdirSync(LOGS_DIR, { recursive: true })
  const logPath = join(LOGS_DIR, 'battlenet-crossover-launch.log')
  const fd = openSync(logPath, 'a')
  log?.(`Opening Battle.net via CrossOver (bottle "${bottle}")...`)
  const proc = spawn(cx.cxstart, ['--bottle', bottle, exe], {
    stdio: ['ignore', fd, fd],
    detached: true
  })
  proc.unref()
  return {
    success: true,
    message: `Battle.net opening via CrossOver (bottle "${bottle}"). This is separate from Kalimotxo's own install.`
  }
}
