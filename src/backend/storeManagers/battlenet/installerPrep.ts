import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'

import { getWineBinary, buildEnv, runExe, applyBattleNetWindowsRegistry } from '../../launcher/wineRunner'
import { battleNetDriveC } from './prefix'
import { BATTLENET_BOTTLE } from './constants'
import {
  ensureRootAgentExe,
  findAgentExe,
  isBattleNetAgentProcessRunning,
  maintainBattleNetAgent,
  pruneBrokenAgentVersions,
  stopBattleNetAgentProcesses
} from './agent'

function programDataBattleNet(bottleName: string): string {
  return join(battleNetDriveC(bottleName), 'ProgramData', 'Battle.net')
}

function logInstall(line: string, logPath?: string): void {
  if (logPath) appendFileSync(logPath, line + '\n')
}

/** enUS locale avoids Agent hangs at 45% (Blizzard/Lutris forums). */
export function applyBattleNetLocaleRegistry(bottleName = BATTLENET_BOTTLE): void {
  const wine = getWineBinary(bottleName)
  const env = buildEnv(bottleName)
  const keys = [
    ['HKCU\\Software\\Blizzard Entertainment\\Battle.net', 'Locale', 'enUS'],
    ['HKCU\\Software\\Blizzard Entertainment\\Battle.net', 'Language', 'enUS'],
    ['HKCU\\Software\\Blizzard Entertainment\\Battle.net', 'Country', 'US']
  ] as const
  for (const [key, name, value] of keys) {
    spawnSync(wine, ['reg', 'add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], {
      env,
      timeout: 15_000
    })
  }
}

/**
 * Agent.exe crashes in wined3d→dxgi (ACCESS_VIOLATION on Apple Silicon) when
 * probing hardware. Force GDI (software) renderer only for Agent.exe.
 */
export function applyAgentGdiRendererRegistry(bottleName = BATTLENET_BOTTLE): void {
  const wine = getWineBinary(bottleName)
  const env = buildEnv(bottleName)
  const key = 'HKCU\\Software\\Wine\\AppDefaults\\Agent.exe\\Direct3D'
  spawnSync(wine, ['reg', 'add', key, '/v', 'renderer', '/t', 'REG_SZ', '/d', 'gdi', '/f'], {
    env,
    timeout: 15_000
  })
}

/** Kills duplicate installer processes (BLZBNTBTS0000000B: another instance running). */
export function stopBlizzardSetupProcesses(): void {
  for (const pattern of [
    'Battle.net-Setup',
    'Battle.net Setup',
    'bna_',
    'Bootstrap',
    'BlizzardError'
  ]) {
    try {
      execSync(`pkill -f "${pattern}" 2>/dev/null || true`, {
        shell: '/bin/bash',
        timeout: 5000
      })
    } catch {
      /* ignore */
    }
  }
}

/** Copies Agent.9464 (7 MB) over the stubs the installer runs at 45%. */
export function repairAgentLayoutForInstall(
  bottleName = BATTLENET_BOTTLE,
  logPath?: string
): boolean {
  const fixed = ensureRootAgentExe(bottleName)
  if (fixed) {
    logInstall(`Agent repaired: ${fixed} (${statSync(fixed).size} bytes)`, logPath)
    return true
  }
  const found = findAgentExe(bottleName)
  if (found) {
    logInstall(`Versioned Agent found but could not be copied: ${found}`, logPath)
  }
  return false
}

/**
 * Before the installer: Win10 + enUS + GDI for Agent.
 */
export function prepareBlizzardInstallerPrefix(
  bottleName = BATTLENET_BOTTLE,
  logPath?: string
): void {
  logInstall('Preparing prefix for Blizzard installer...', logPath)
  applyBattleNetWindowsRegistry(bottleName, { force: true })
  applyBattleNetLocaleRegistry(bottleName)
  applyAgentGdiRendererRegistry(bottleName)

  const pd = programDataBattleNet(bottleName)
  mkdirSync(join(pd, 'Agent'), { recursive: true })
  repairAgentLayoutForInstall(bottleName, logPath)
}

/**
 * Pre-start Agent.exe before the installer so Agent.dat is already present
 * when the installer's BSAgentManager tries to communicate.
 */
export async function preWarmAgent(
  bottleName = BATTLENET_BOTTLE,
  logPath?: string
): Promise<{ port: number | null; agentDatPath: string | null }> {
  const pd = programDataBattleNet(bottleName)
  const agentDatPath = join(pd, 'Agent.dat')
  const agentExe = ensureRootAgentExe(bottleName) ?? findAgentExe(bottleName)

  if (!agentExe) {
    logInstall('pre-warm: Agent.exe not found, installer will download it', logPath)
    return { port: null, agentDatPath: null }
  }

  stopBattleNetAgentProcesses()
  await new Promise((r) => setTimeout(r, 1500))

  logInstall(`pre-warm: Starting Agent.exe...`, logPath)
  runExe(bottleName, agentExe, { battleNetEnv: true, logPath })

  const timeoutMs = 90_000
  const started = Date.now()
  let port: number | null = null

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      if (existsSync(agentDatPath)) {
        const raw = readFileSync(agentDatPath, 'utf-8').trim()
        const parsed = parseInt(raw, 10)
        if (parsed > 0 && parsed < 65536) {
          port = parsed
          logInstall(`pre-warm: Agent ready on port ${port} (${Math.round((Date.now() - started) / 1000)}s)`, logPath)
          return { port, agentDatPath }
        }
      }
    } catch { /* retry */ }

    if (!isBattleNetAgentProcessRunning(bottleName) && Date.now() - started > 20_000) {
      logInstall('pre-warm: Agent died — retrying...', logPath)
      runExe(bottleName, agentExe, { battleNetEnv: true, logPath })
    }
  }

  logInstall('pre-warm: Timeout waiting for Agent.dat (90s) — installer will try on its own', logPath)
  return { port: null, agentDatPath: null }
}

let installerWatchInterval: ReturnType<typeof setInterval> | null = null

/** While the installer is running: wakes the Agent without killing Battle.net-Setup.exe. */
export function startInstallerAgentWatchdog(
  bottleName = BATTLENET_BOTTLE,
  logPath?: string
): void {
  stopInstallerAgentWatchdog()
  let ticks = 0
  logInstall('Install watchdog: monitoring Agent (45%)...', logPath)

  installerWatchInterval = setInterval(() => {
    void (async () => {
      ticks++
      try {
        pruneBrokenAgentVersions(bottleName)
        repairAgentLayoutForInstall(bottleName, logPath)

        const pd = programDataBattleNet(bottleName)
        const agentDir = join(pd, 'Agent')
        const hasVersion =
          existsSync(agentDir) &&
          readdirSync(agentDir).some((n) => /^Agent\.\d+$/i.test(n))
        const hasVersionPd =
          existsSync(pd) && readdirSync(pd).some((n) => /^Agent\.\d+$/i.test(n))
        const agentRunning = isBattleNetAgentProcessRunning(bottleName)

        if (!agentRunning && (hasVersion || hasVersionPd || ticks >= 2)) {
          await maintainBattleNetAgent(bottleName, {
            installAssist: true,
            logPath,
            log: (line) => logInstall(line, logPath)
          })
          repairAgentLayoutForInstall(bottleName, logPath)
        }
      } catch (e) {
        logInstall(
          `watchdog: ${e instanceof Error ? e.message : String(e)}`,
          logPath
        )
      }
    })()
  }, 20_000)
}

export function stopInstallerAgentWatchdog(): void {
  if (installerWatchInterval) {
    clearInterval(installerWatchInterval)
    installerWatchInterval = null
  }
}

/** Total Agent/ folder size for diagnosing install progress in logs. */
export function agentInstallBytes(bottleName = BATTLENET_BOTTLE): number {
  const pd = programDataBattleNet(bottleName)
  let total = 0
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isFile()) total += st.size
      else if (st.isDirectory()) walk(p)
    }
  }
  try {
    if (existsSync(pd)) walk(pd)
  } catch {
    return 0
  }
  return total
}
