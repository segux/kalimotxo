import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
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
import { buildBattleNetLaunchEnv, runExe, stopWineProcesses } from '../../launcher/wineRunner'
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
  if (backend === 'd3dmetal') {
    let [d3dOk, d3dMsg] = ensureD3dmetalForDx12Games()
    if (!d3dOk) {
      log?.('Installing D3DMetal automatically...')
      ;[d3dOk, d3dMsg] = await ensureD3dmetal({ onLog: log })
    }
    if (!d3dOk) return [false, d3dMsg]
  }

  const [gfxOk, gfxMsg] = applyGraphicsBackend(bottleName, backend)
  if (!gfxOk) return [false, gfxMsg]

  const cfg = getBottleConfig(bottleName)
  cfg.sync_mode = profile.sync === 'msync' ? 'msync' : profile.sync === 'esync' ? 'esync' : 'none'
  cfg.env_vars = { ...cfg.env_vars, ...profile.env }
  for (const [dll, mode] of Object.entries(profile.dll_overrides)) {
    cfg.dll_overrides[dll] = mode
  }
  if (profile.sync === 'esync') {
    cfg.env_vars.WINEESYNC = '1'
    delete cfg.env_vars.WINEMSYNC
  } else if (profile.sync === 'msync') {
    cfg.env_vars.WINEMSYNC = '1'
    delete cfg.env_vars.WINEESYNC
  } else {
    delete cfg.env_vars.WINEESYNC
    delete cfg.env_vars.WINEMSYNC
  }
  saveBottleConfig(bottleName, cfg)
  return [true, gfxMsg]
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

  stopWineProcesses(BATTLENET_BOTTLE, { wait: false })

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

  return {
    success: true,
    message: `${getGameProfile(gameId)?.name ?? gameId} is running. After playing, click Open Battle.net to return to launcher mode. Log: ${logPath}`
  }
}

/** Restores the wined3d layer for the Battle.net client (like CrossOver when returning to launcher). */
export function restoreBattleNetLauncherGraphics(
  bottleName = BATTLENET_BOTTLE
): [boolean, string] {
  prepareBottleForLauncher(bottleName)
  return applyGraphicsBackend(bottleName, BATTLENET_LAUNCHER_BACKEND as GraphicsBackendId)
}
