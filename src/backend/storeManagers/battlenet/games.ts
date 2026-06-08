import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getBottleConfig, saveBottleConfig } from '../../bottle'
import { LOGS_DIR } from '../../config/paths'
import {
  BLIZZARD_GAME_IDS,
  getGameProfile,
  resolveGameExe,
  type BlizzardGameId
} from '../../compatibility/catalog'

export type { BlizzardGameId }
import { buildBattleNetLaunchEnv, runExe } from '../../launcher/wineRunner'
import { applyGraphicsBackend, applyGraphicsEnv, type GraphicsBackendId } from '../../wine/graphicsBackend'
import { mergeDllOverrides } from '../../wine/wineEnv'
import { ensureD3dmetal, ensureD3dmetalForDx12Games } from '../../wine/d3dmetalSetup'
import { getBottlePath } from '../../bottle'
import { prepareBattleNetWineLaunch } from '../../wine/prepareLaunch'
import { resolveBattleNetWineInstallation } from '../../wine/compatibilityLayers'
import { ensureBattleNetWineRuntimeLibs } from '../../wine/wineRuntimeLibs'
import { startAgentPortBridge } from './agentPortBridge'
import { markGameManaged, markPidManaged } from './gameWatcher'
import { BATTLENET_BOTTLE, BATTLENET_LAUNCHER_BACKEND } from './constants'
import { ensureLaunchDependencies } from './deps'
import { sendFrontendMessage } from '../../ipc'
import { isBattleNetInstalled } from './client'
import { prepareBottleForLauncher } from './launcherPrep'

export type InstalledBlizzardGame = {
  id: BlizzardGameId
  name: string
  exePath: string
  backend: string
  rating: number
}

export function listInstalledBlizzardGames(
  bottleName = BATTLENET_BOTTLE
): InstalledBlizzardGame[] {
  const out: InstalledBlizzardGame[] = []
  for (const id of BLIZZARD_GAME_IDS) {
    const profile = getGameProfile(id)
    if (!profile) continue
    const exe = resolveGameExe(bottleName, id)
    if (!exe) continue
    out.push({
      id,
      name: profile.name,
      exePath: exe,
      backend: profile.backend,
      rating: profile.rating ?? 0
    })
  }
  return out
}

async function applyGameProfileToBottle(
  bottleName: string,
  profileId: BlizzardGameId,
  log?: (m: string) => void
): Promise<[boolean, string]> {
  const profile = getGameProfile(profileId)
  if (!profile) return [false, `Unknown profile: ${profileId}`]

  const backend = profile.backend as GraphicsBackendId

  // D3DMetal (DX12) games: ensure the framework is available before launch.
  // DXMT games load their DLLs via WINEDLLPATH — no file copy needed here.
  if (backend === 'd3dmetal') {
    let [d3dOk, d3dMsg] = ensureD3dmetalForDx12Games()
    if (!d3dOk) {
      log?.('Installing D3DMetal automatically...')
      ;[d3dOk, d3dMsg] = await ensureD3dmetal({ onLog: log })
    }
    if (!d3dOk) return [false, d3dMsg]
    // Copy D3DMetal framework into the bottle so DYLD_FRAMEWORK_PATH can find it.
    const [copyOk, copyMsg] = applyGraphicsBackend(bottleName, backend)
    if (!copyOk) return [false, copyMsg]
    return [true, copyMsg]
  }

  // Persist the profile's sync mode and env vars to bottle config for UI display.
  // The launch environment is built directly from the profile in buildGameLaunchEnv,
  // so this is informational only — it does not affect what the game process sees.
  const cfg = getBottleConfig(bottleName)
  cfg.sync_mode = profile.sync === 'msync' ? 'msync' : profile.sync === 'esync' ? 'esync' : 'none'
  saveBottleConfig(bottleName, cfg)
  return [true, `Profile applied: ${profileId}`]
}

/**
 * Build a launch environment for a specific game profile, bypassing the global
 * bottle state (which may have been reset to wined3d by prepareBottleForLauncher).
 * Inspired by Heroic Game Launcher: per-game env, not per-bottle mutation.
 */
function buildGameLaunchEnv(
  bottleName: string,
  profile: ReturnType<typeof getGameProfile>
): NodeJS.ProcessEnv {
  if (!profile) return buildBattleNetLaunchEnv(bottleName, { gameLaunch: true })

  // Start with the standard Battle.net launch environment
  const env = buildBattleNetLaunchEnv(bottleName, { gameLaunch: true })

  // Apply the graphics backend from the profile directly (do not trust bottle.json)
  applyGraphicsEnv(env, profile.backend as GraphicsBackendId)

  // applyGraphicsEnv uses the global D3DMETAL_DIR for d3dmetal. Prefer the
  // local copy inside the bottle if it exists (copied by applyGraphicsBackend).
  if (profile.backend === 'd3dmetal') {
    const localD3dmetal = join(getBottlePath(bottleName), 'd3dmetal')
    const d3dmetalFw = join(localD3dmetal, 'D3DMetal.framework')
    const d3dshared = join(localD3dmetal, 'libd3dshared.dylib')
    if (existsSync(d3dmetalFw)) {
      env.D3DMETAL = '1'
      env.DYLD_FRAMEWORK_PATH = localD3dmetal
      env.DYLD_LIBRARY_PATH = localD3dmetal
      env.CX_ACTIVE_GRAPHICS_BACKEND = 'd3dmetal'
      if (existsSync(d3dshared)) {
        env.CX_APPLEGPTK_LIBD3DSHARED_PATH = d3dshared
      }
    }
  }

  // Apply DLL overrides from the profile directly.
  // CRITICAL: D3DMetal requires Wine builtins (not native) for d3d11/d3d12/dxgi.
  // system32 holds CrossOver's D3DMetal-backed DLLs (dxgi.dll 93KB). For both
  // dxmt and d3dmetal backends these must be loaded as builtin (from WINEDLLPATH)
  // so Wine finds the real DXMT/D3DMetal DLLs instead of the CrossOver stubs.
  const DXGI_DLLS = ['d3d11', 'd3d12', 'dxgi', 'd3d10core']
  if (Object.keys(profile.dll_overrides).length > 0) {
    const overrides = Object.entries(profile.dll_overrides).map(
      ([dll, mode]) => {
        if (
          (profile.backend === 'd3dmetal' || profile.backend === 'dxmt') &&
          DXGI_DLLS.includes(dll)
        ) {
          return `${dll}=builtin`
        }
        return `${dll}=${mode}`
      }
    )
    env.WINEDLLOVERRIDES = mergeDllOverrides(env.WINEDLLOVERRIDES, overrides)
  }

  // Apply env vars from the profile
  for (const [k, v] of Object.entries(profile.env)) {
    env[k] = v
  }

  // Apply sync mode from the profile
  if (profile.sync === 'esync') {
    env.WINEESYNC = '1'
    delete env.WINEMSYNC
  } else if (profile.sync === 'msync') {
    env.WINEMSYNC = '1'
    delete env.WINEESYNC
  } else {
    delete env.WINEESYNC
    delete env.WINEMSYNC
  }

  // macOS D3DMetal fix: Heroic enables both msync + esync for toolkit wines
  if (profile.backend === 'd3dmetal') {
    env.WINEMSYNC = '1'
    env.WINEESYNC = '1'
  } else if (profile.backend === 'dxmt') {
    env.WINEMSYNC = '1'
  }

  return env
}

/** Launches a Blizzard game installed in the Battle.net bottle (CrossOver-style profile). */
export async function launchBlizzardGame(
  gameId: BlizzardGameId
): Promise<{ success: boolean; message: string }> {
  const logPath = join(LOGS_DIR, `game-${gameId}-launch.log`)
  mkdirSync(LOGS_DIR, { recursive: true })
  writeFileSync(logPath, `--- launch ${gameId} ${new Date().toISOString()} ---\n`)
  const log = (m: string): void => appendFileSync(logPath, m + '\n')

  if (!isBattleNetInstalled()) {
    const { play } = await import('./service')
    const opened = await play()
    if (!opened.success) return opened
    if (!isBattleNetInstalled()) {
      return { success: false, message: 'Open Battle.net first using the main button' }
    }
  }

  const profile = getGameProfile(gameId)
  if (profile?.backend === 'd3dmetal') {
    const { isD3dmetalInstalled } = await import('../../setup/runtimePaths')
    if (!isD3dmetalInstalled()) {
      log('Installing graphics layer for this game...')
      const { ensureD3dmetal } = await import('../../wine/d3dmetalSetup')
      await ensureD3dmetal({ onLog: log })
    }
  }

  const exe = resolveGameExe(BATTLENET_BOTTLE, gameId)
  if (!exe) {
    const profile = getGameProfile(gameId)
    return {
      success: false,
      message: `${profile?.name ?? gameId} is not installed. Install it from Battle.net.`
    }
  }

  const { ensureBattleNetBottleDeps } = await import('../../setup/ensureEnvironment')
  const [prepOk, prepMsg] = await ensureBattleNetBottleDeps(log)
  if (!prepOk) return { success: false, message: prepMsg }

  const [depsOk, depsMsg] = await ensureLaunchDependencies(log)
  if (!depsOk) return { success: false, message: depsMsg }

  // Do NOT kill wineserver here: the Battle.net Update Agent must stay alive
  // for D2R (and other Blizzard games) to authenticate online. The game watcher
  // already kills the specific D2R.exe child process before relaunching, and
  // the new D2R process shares the same wineserver as the Agent.
  // stopWineProcesses would kill the Agent → "error de conexión" in online mode.

  // Persist profile to bottle config for UI display (secondary — env is built
  // directly from profile below to avoid prepareBottleForLauncher races).
  const [, profileMsg] = await applyGameProfileToBottle(BATTLENET_BOTTLE, gameId, log)
  log(profileMsg)

  const prep = prepareBattleNetWineLaunch(logPath)
  if (!prep.ok) return { success: false, message: prep.message }

  // macOS strips DYLD_* from Wine child processes -> MoltenVK/gnutls do not
  // load via DYLD_FALLBACK. Copying them into lib/wine/x86_64-unix makes them
  // load via @loader_path (GPU + TLS). See wineRuntimeLibs.ts.
  const installation = resolveBattleNetWineInstallation()
  try {
    ensureBattleNetWineRuntimeLibs(installation, log)
  } catch (e) {
    log(`Warning: could not prepare runtime libs: ${String(e)}`)
  }

  // Bridge 1120 -> Agent's real port (Agent.dat). Without it the client gets
  // CURL error=7 / BLZBNTBNA00000005. See agentPortBridge.ts.
  startAgentPortBridge(BATTLENET_BOTTLE)

  // Build the env directly from the game profile (Heroic-style).
  // Do NOT rely on bottle.json being in the right state.
  const gameEnv = buildGameLaunchEnv(BATTLENET_BOTTLE, profile)
  // Mark this process as Kalimotxo-managed so the gameWatcher ignores it
  gameEnv.KALIMOTXO_MANAGED = '1'

  const exeName = exe.split(/[/\\]/).pop() ?? 'game.exe'
  log(`Launching ${exeName} (${gameId}) with backend ${profile?.backend ?? 'default'}...`)
  log(`Overrides: ${gameEnv.WINEDLLOVERRIDES ?? '(none)'}`)
  const proc = runExe(BATTLENET_BOTTLE, exe, { battleNetEnv: true, gameLaunch: true, logPath, env: gameEnv, args: profile?.args })

  // Prevent the watcher from killing this newly launched game:
  // - markGameManaged: cooldown by gameId (the Wine loader PID != D2R.exe child PID)
  // - markPidManaged: PID-based guard as a secondary safety net
  markGameManaged(gameId)
  if (proc.pid) {
    log(`Marking pid ${proc.pid} as Kalimotxo-managed`)
    markPidManaged(proc.pid)
  }

  const blzLogPath = join(
    getBottlePath(BATTLENET_BOTTLE),
    'drive_c',
    exe.split(/[/\\]/).slice(0, -1).join('/'),
    'blz-log.txt'
  )
  watchForEarlyExit(proc, gameId, profile?.name ?? gameId, blzLogPath)

  return {
    success: true,
    message: `${getGameProfile(gameId)?.name ?? gameId} is running. After playing, click Open Battle.net to return to launcher mode. Log: ${logPath}`
  }
}

const KNOWN_CRASH_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /LoadLibrary.*dxgi.*Failed|failed to create Prism/i,
    message: 'Graphics system failed to initialize. Try reinstalling the game from Battle.net.'
  },
  {
    pattern: /Failed to initialize graphics system/i,
    message: 'Graphics system failed. Make sure your macOS and Kalimotxo are up to date.'
  },
  {
    pattern: /not.*installed|game.*not.*found/i,
    message: 'Game files not found. Reinstall the game from Battle.net.'
  }
]

function friendlyErrorFromLog(blzLogPath: string): string | null {
  try {
    const text = readFileSync(blzLogPath, 'utf-8').slice(-4000)
    for (const { pattern, message } of KNOWN_CRASH_PATTERNS) {
      if (pattern.test(text)) return message
    }
  } catch {
    /* log not available */
  }
  return null
}

function watchForEarlyExit(
  proc: ReturnType<typeof runExe>,
  gameId: string,
  gameName: string,
  blzLogPath: string,
  windowMs = 15_000
): void {
  const timer = setTimeout(() => proc.off('exit', onExit), windowMs)
  function onExit(code: number | null): void {
    clearTimeout(timer)
    if (code === 0 || code === null) return
    const detail = friendlyErrorFromLog(blzLogPath) ?? 'The game closed unexpectedly.'
    sendFrontendMessage('gameLaunchError', { gameId, gameName, message: detail })
  }
  proc.once('exit', onExit)
}

/** Restores the wined3d layer for the Battle.net client (like CrossOver when returning to launcher). */
export function restoreBattleNetLauncherGraphics(
  bottleName = BATTLENET_BOTTLE
): [boolean, string] {
  prepareBottleForLauncher(bottleName)
  return applyGraphicsBackend(bottleName, BATTLENET_LAUNCHER_BACKEND as GraphicsBackendId)
}
