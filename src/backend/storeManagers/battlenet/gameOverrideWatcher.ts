import { appendFileSync, watch, type FSWatcher } from 'fs'
import { dirname, join } from 'path'

import { LOGS_DIR } from '../../config/paths'
import {
  BLIZZARD_GAME_IDS,
  getGameProfile,
  resolveGameExe,
  type BlizzardGameId
} from '../../compatibility/catalog'
import { getActiveWineInstallation } from '../../launcher/wineRunner'
import { DXMT_NATIVE_DLLS, ensureDxmtForExe } from '../../wine/dxmt'
import { ensureD3dmetalDx12ForExe } from '../../wine/d3dmetalDx12'
import { BATTLENET_BOTTLE } from './constants'

/**
 * Battle.net patches (or "repairs") installed games every time it opens —
 * confirmed on Diablo II: Resurrected, where it silently restored the
 * original `d3d12.dll` a few minutes after Kalimotxo had put its D3DMetal
 * forwarder there, undoing the fix before the game was ever launched. The
 * same risk applies to any DXMT profile that overrides `d3d11.dll`/`dxgi.dll`
 * /`d3d10core.dll` in place (WoW, Overwatch, Hearthstone, StarCraft II).
 *
 * Killing and relaunching the game process to reapply the fix was tried
 * before and dropped: it invalidates the Battle.net session token
 * ("error de conexión" in online mode — see `service.ts`). This instead
 * watches each installed game's own folder and puts Kalimotxo's override
 * DLL back the moment Battle.net's patcher rewrites it, without ever
 * touching the running process. As long as this wins the race before the
 * game process is next started, it makes no difference which one restored
 * the file last.
 */

const REAPPLY_DEBOUNCE_MS = 400

type OverrideDlls = { dlls: readonly string[]; ensure: (exe: string, log?: (m: string) => void) => boolean }

function overridesForProfile(backend: string): OverrideDlls | null {
  if (backend === 'dxmt') {
    return { dlls: DXMT_NATIVE_DLLS, ensure: (exe, log) => ensureDxmtForExe(getActiveWineInstallation(), exe, log) }
  }
  if (backend === 'd3dmetal-dx12') {
    return { dlls: ['d3d12', 'dxgi'], ensure: (exe, log) => ensureD3dmetalDx12ForExe(getActiveWineInstallation(), exe, log) }
  }
  return null
}

const watchers = new Map<BlizzardGameId, FSWatcher>()
const pendingReapply = new Map<BlizzardGameId, NodeJS.Timeout>()
let logPath: string | null = null

function log(m: string): void {
  try {
    if (!logPath) logPath = join(LOGS_DIR, 'game-override-watcher.log')
    appendFileSync(logPath, `${new Date().toISOString()} ${m}\n`)
  } catch {
    /* ignore */
  }
}

/**
 * Watches one installed game's own folder and reapplies its DLL overrides
 * whenever Battle.net rewrites them. Safe to call repeatedly: replaces any
 * existing watcher for that game rather than stacking them.
 */
function watchGame(id: BlizzardGameId, exe: string, overrides: OverrideDlls): void {
  watchers.get(id)?.close()
  const dir = dirname(exe)
  const names = new Set(overrides.dlls.map((d) => `${d}.dll`))

  const watcher = watch(dir, (_event, filename) => {
    if (!filename || !names.has(filename)) return
    const existing = pendingReapply.get(id)
    if (existing) clearTimeout(existing)
    pendingReapply.set(
      id,
      setTimeout(() => {
        pendingReapply.delete(id)
        log(`${id}: ${filename} changed, reapplying overrides`)
        overrides.ensure(exe, log)
      }, REAPPLY_DEBOUNCE_MS).unref()
    )
  })
  watcher.on('error', (e) => log(`${id}: watcher error, stopping (${String(e)})`))
  watchers.set(id, watcher)
}

/**
 * Starts (or refreshes) watchers for every installed game whose profile
 * overrides DLLs in its own folder. Call whenever Battle.net opens, right
 * after the initial override application — cheap and idempotent.
 */
export function startGameOverrideWatchers(bottleName = BATTLENET_BOTTLE): void {
  for (const id of BLIZZARD_GAME_IDS) {
    const profile = getGameProfile(id)
    if (!profile) continue
    const overrides = overridesForProfile(profile.backend)
    if (!overrides) continue
    const exe = resolveGameExe(bottleName, id)
    if (!exe) continue
    watchGame(id, exe, overrides)
  }
}

export function stopGameOverrideWatchers(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  for (const timer of pendingReapply.values()) clearTimeout(timer)
  pendingReapply.clear()
}
