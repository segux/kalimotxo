import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ChildProcess } from 'child_process'
import { execSync, spawn as cpSpawn, spawnSync } from 'child_process'
import { getBottleConfig, getBottlePath } from '../bottle'
import { BATTLENET_BOTTLE } from '../storeManagers/battlenet/constants'
import {
  resolveBattleNetWineInstallation,
  resolveCrossoverBottleName
} from '../wine/compatibilityLayers'
import { applyGraphicsEnvForBottle } from '../wine/graphicsBackend'
import { mergeDllOverrides, setupWineEnvVars } from '../wine/wineEnv'
import type { WineInstallation } from '../wine/types'
import { filterWinetricksLogLine } from '../tools/winetricksLog'
import { killWineServersForBottle } from '../wine/wineServerKill'

let cachedInstallation: WineInstallation | null = null

function activeInstallation(): WineInstallation {
  if (!cachedInstallation) {
    cachedInstallation = resolveBattleNetWineInstallation()
  }
  return cachedInstallation
}

export function resetWineInstallationCache(): void {
  cachedInstallation = null
}

export function getWineBinary(_bottleName: string): string {
  return activeInstallation().bin
}

export function getActiveWineInstallation(): WineInstallation {
  return activeInstallation()
}

export function buildEnv(bottleName: string): NodeJS.ProcessEnv {
  const cfg = getBottleConfig(bottleName)
  const prefix = getBottlePath(bottleName)
  const installation = activeInstallation()
  return setupWineEnvVars(
    {
      ...process.env,
      WINEDEBUG: '-all'
    },
    installation,
    {
      winePrefix: prefix,
      crossoverBottle: resolveCrossoverBottleName(),
      bottleEnvVars: cfg.env_vars,
      battleNetLaunch: false
    }
  )
}

export function buildBattleNetLaunchEnv(
  bottleName: string,
  options?: { gameLaunch?: boolean }
): NodeJS.ProcessEnv {
  const cfg = getBottleConfig(bottleName)
  const prefix = getBottlePath(bottleName)
  const installation = activeInstallation()
  const env = setupWineEnvVars(
    { ...process.env },
    installation,
    {
      winePrefix: prefix,
      crossoverBottle: resolveCrossoverBottleName(),
      bottleEnvVars: cfg.env_vars,
      battleNetLaunch: true,
      gameLaunch: options?.gameLaunch
    }
  )
  if (options?.gameLaunch) {
    applyGraphicsEnvForBottle(env, bottleName)
  }
  return env
}

export function attachWineProcessLog(
  proc: ChildProcess,
  logPath: string,
  onLine?: (line: string) => void
): void {
  const write = (chunk: Buffer | string): void => {
    const text = chunk.toString()
    appendFileSync(logPath, text)
    for (const raw of text.split(/\r?\n/)) {
      const line = filterWinetricksLogLine(raw)
      if (line) onLine?.(line)
    }
  }
  proc.stdout?.on('data', write)
  proc.stderr?.on('data', write)
  proc.on('exit', (code) => {
    appendFileSync(logPath, `\n--- wine exit ${code ?? '?'} ---\n`)
  })
}

export function runExe(
  bottleName: string,
  exePath: string,
  options?: {
    battleNetEnv?: boolean
    gameLaunch?: boolean
    cwd?: string
    logPath?: string
    args?: string[]
    env?: NodeJS.ProcessEnv
  }
): ChildProcess {
  const wine = getWineBinary(bottleName)
  const env = options?.env ?? (options?.battleNetEnv
    ? buildBattleNetLaunchEnv(bottleName, { gameLaunch: options.gameLaunch })
    : buildEnv(bottleName))
  const proc = cpSpawn(wine, [exePath, ...(options?.args ?? [])], {
    env,
    cwd: options?.cwd || join(exePath, '..'),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (options?.logPath) {
    attachWineProcessLog(proc, options.logPath, (line) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[wine] ${line}`)
      }
    })
  }
  proc.unref()
  return proc
}

export function killBottle(bottleName: string): void {
  const installation = activeInstallation()
  const wineserver =
    installation.wineserver ?? installation.bin.replace(/wine64?$/, 'wineserver')
  if (!existsSync(wineserver)) return
  const env = buildEnv(bottleName)
  spawnSync(wineserver, ['-k'], { env, timeout: 15_000 })
}

/**
 * Stops Wine processes for the prefix. `wait: true` uses wineserver -w (up to ~90s) — only for winetricks/repair.
 * Do not use -w during Play: if Battle.net is still open, -w blocks IPC until the user closes the client.
 */
export function stopWineProcesses(
  bottleName: string,
  options?: { wait?: boolean }
): void {
  const env = buildEnv(bottleName)
  killWineServersForBottle(bottleName, env)

  if (!options?.wait) return

  const installation = activeInstallation()
  const wineserver =
    installation.wineserver ?? installation.bin.replace(/wine64?$/, 'wineserver')
  if (wineserver && existsSync(wineserver)) {
    spawnSync(wineserver, ['-w'], { env, timeout: 90_000 })
  }
}

/** @deprecated Usar stopWineProcesses(bottle, { wait: true }) */
export function stopWineForWinetricks(bottleName: string): void {
  stopWineProcesses(bottleName, { wait: true })
}

const WIN10_REGISTRY_MARKER = '.kalimotxo-win10-registry-v2'

/**
 * Build 19042 prevents Battle.net from detecting macOS. Avoid running `winecfg` on each
 * launch: winecfg refreshes the prefix and causes ucrtbase.dll error=80 on already-configured bottles.
 */
export function applyBattleNetWindowsRegistry(
  bottleName = BATTLENET_BOTTLE,
  options?: { force?: boolean }
): void {
  if (resolveCrossoverBottleName()) return

  const prefix = getBottlePath(bottleName)
  const marker = join(prefix, WIN10_REGISTRY_MARKER)
  if (!options?.force && existsSync(marker)) return

  const wine = getWineBinary(bottleName)
  const env = buildEnv(bottleName)
  const versionKey = 'HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion'
  for (const [name, value] of [
    ['CurrentVersion', '10.0'],
    ['CurrentBuild', '19042'],
    ['CurrentBuildNumber', '19042']
  ] as const) {
    spawnSync(
      wine,
      ['reg', 'add', versionKey, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
      { env, timeout: 30_000 }
    )
  }

  const agentD3dKey = 'HKCU\\Software\\Wine\\AppDefaults\\Agent.exe\\Direct3D'
  spawnSync(wine, ['reg', 'add', agentD3dKey, '/v', 'renderer', '/t', 'REG_SZ', '/d', 'gdi', '/f'], {
    env,
    timeout: 15_000
  })

  // Disable Wine's crash dialog (same as D4Mac): a `division by zero` in a
  // CEF thread must not block the client from starting.
  const crashKey = 'HKCU\\Software\\Wine\\WineDbg'
  spawnSync(
    wine,
    ['reg', 'add', crashKey, '/v', 'ShowCrashDialog', '/t', 'REG_DWORD', '/d', '0', '/f'],
    { env, timeout: 15_000 }
  )

  writeFileSync(marker, new Date().toISOString() + '\n')
}
