import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getBottlePath } from '../../bottle'
import {
  BLIZZARD_GAME_IDS,
  getGameProfile,
  resolveGameExe,
  type GameProfile
} from '../../compatibility/catalog'
import { buildEnv, getActiveWineInstallation, getWineBinary } from '../../launcher/wineRunner'
import { DXMT_NATIVE_DLLS, ensureDxmtForExe } from '../../wine/dxmt'
import { ensureD3dmetalDx12ForExe } from '../../wine/d3dmetalDx12'
import { BATTLENET_BOTTLE } from './constants'

/**
 * Games started from Battle.net's "Play" button inherit the client's
 * environment, not the Kalimotxo game profile (which only applies when the game
 * is launched from Kalimotxo). Persist what can live in the bottle instead:
 * - DLL overrides -> `HKCU\Software\Wine\AppDefaults\<exe>\DllOverrides`
 *   (Wine applies them per executable, whoever starts it).
 * - Launch arguments -> Battle.net.config `Games.<product>.AdditionalLaunchArguments`
 *   (the "Additional command line arguments" game setting).
 */

const APPDEFAULTS_MARKER = '.kalimotxo-game-appdefaults'
const DXGI_DLLS = ['d3d11', 'd3d12', 'dxgi', 'd3d10core']

/**
 * Profile DLL overrides as Wine modes. DXMT's D3D/DXGI DLLs live next to the
 * game's exe and must load as native (see wine/dxmt.ts); D3DMetal's come from
 * CrossOver's builtins.
 */
export function resolveProfileDllOverrides(profile: GameProfile): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [dll, mode] of Object.entries(profile.dll_overrides)) {
    out[dll] = profile.backend === 'd3dmetal' && DXGI_DLLS.includes(dll) ? 'builtin' : mode
  }
  if (profile.backend === 'dxmt') {
    for (const dll of DXMT_NATIVE_DLLS) out[dll] = 'native'
  }
  return out
}

/**
 * Puts DXMT next to every installed DXMT game, so it is used whoever starts the
 * game (Battle.net's Play button included). Returns the games prepared.
 */
export function applyDxmtToInstalledGames(
  bottleName = BATTLENET_BOTTLE,
  log?: (m: string) => void
): string[] {
  const done: string[] = []
  for (const id of BLIZZARD_GAME_IDS) {
    const profile = getGameProfile(id)
    const exe = profile?.backend === 'dxmt' ? resolveGameExe(bottleName, id) : null
    if (exe && ensureDxmtForExe(getActiveWineInstallation(), exe, log)) done.push(id)
  }
  return done
}

/**
 * Puts real D3DMetal (DX12) next to every installed game profiled for it
 * (currently just Diablo II: Resurrected, DX12-only). See `d3dmetalDx12.ts`.
 */
export function applyD3dmetalDx12ToInstalledGames(
  bottleName = BATTLENET_BOTTLE,
  log?: (m: string) => void
): string[] {
  const done: string[] = []
  for (const id of BLIZZARD_GAME_IDS) {
    const profile = getGameProfile(id)
    const exe = profile?.backend === 'd3dmetal-dx12' ? resolveGameExe(bottleName, id) : null
    if (exe && ensureD3dmetalDx12ForExe(getActiveWineInstallation(), exe, log)) done.push(id)
  }
  return done
}

function regEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** REGEDIT4 text with one AppDefaults DllOverrides key per game executable. */
export function buildGameAppDefaultsReg(profiles: GameProfile[]): string {
  const lines = ['REGEDIT4', '']
  for (const profile of profiles) {
    const overrides = resolveProfileDllOverrides(profile)
    if (!Object.keys(overrides).length) continue
    const exeName = profile.exe.split(/[/\\]/).pop()!
    lines.push(`[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\${regEscape(exeName)}\\DllOverrides]`)
    for (const [dll, mode] of Object.entries(overrides)) {
      lines.push(`"${regEscape(dll)}"="${regEscape(mode)}"`)
    }
    lines.push('')
  }
  return lines.length > 2 ? lines.join('\r\n') : ''
}

function installedProfiles(bottleName: string): GameProfile[] {
  return BLIZZARD_GAME_IDS.filter((id) => resolveGameExe(bottleName, id))
    .map((id) => getGameProfile(id))
    .filter((p): p is GameProfile => p !== null)
}

/** Imports the per-exe overrides with a single `regedit`, only when they changed. */
export function applyGameAppDefaults(
  bottleName = BATTLENET_BOTTLE,
  log?: (m: string) => void
): boolean {
  const reg = buildGameAppDefaultsReg(installedProfiles(bottleName))
  if (!reg) return false
  const prefix = getBottlePath(bottleName)
  const marker = join(prefix, APPDEFAULTS_MARKER)
  const hash = createHash('sha1').update(reg).digest('hex')
  try {
    if (readFileSync(marker, 'utf-8').trim() === hash) return false
  } catch {
    /* first run */
  }

  const regFile = join(prefix, 'drive_c', 'kalimotxo-game-appdefaults.reg')
  writeFileSync(regFile, reg)
  try {
    const r = spawnSync(
      getWineBinary(bottleName),
      ['regedit', '/S', 'C:\\kalimotxo-game-appdefaults.reg'],
      { env: buildEnv(bottleName), timeout: 30_000 }
    )
    if (r.status !== 0) {
      log?.(`Game DLL overrides: regedit failed (${r.status ?? r.signal})`)
      return false
    }
    writeFileSync(marker, hash + '\n')
    log?.('Game DLL overrides written to AppDefaults')
    return true
  } finally {
    rmSync(regFile, { force: true })
  }
}

type BattleNetConfig = { Games?: Record<string, Record<string, unknown>> } & Record<string, unknown>

/**
 * Sets `AdditionalLaunchArguments` for installed games whose profile has args,
 * unless the user already set their own. Call only while the client is closed:
 * Battle.net rewrites this file on exit.
 */
export function applyBattleNetLaunchArgs(
  bottleName = BATTLENET_BOTTLE,
  log?: (m: string) => void
): string[] {
  const wanted = installedProfiles(bottleName).filter((p) => p.bnet_product && p.args?.length)
  if (!wanted.length) return []

  const usersDir = join(getBottlePath(bottleName), 'drive_c', 'users')
  let users: string[] = []
  try {
    users = readdirSync(usersDir)
  } catch {
    return []
  }

  const changed: string[] = []
  for (const user of users) {
    const path = join(usersDir, user, 'AppData', 'Roaming', 'Battle.net', 'Battle.net.config')
    if (!existsSync(path)) continue
    let cfg: BattleNetConfig
    try {
      cfg = JSON.parse(readFileSync(path, 'utf-8')) as BattleNetConfig
    } catch {
      continue
    }
    let dirty = false
    cfg.Games ??= {}
    for (const profile of wanted) {
      const game = (cfg.Games[profile.bnet_product!] ??= {})
      const current = game.AdditionalLaunchArguments
      if (typeof current === 'string' && current.trim()) continue
      game.AdditionalLaunchArguments = profile.args!.join(' ')
      changed.push(`${profile.name}: ${game.AdditionalLaunchArguments}`)
      dirty = true
    }
    if (dirty) writeFileSync(path, JSON.stringify(cfg, null, 4))
  }
  if (changed.length) log?.(`Battle.net launch arguments: ${changed.join(', ')}`)
  return changed
}
