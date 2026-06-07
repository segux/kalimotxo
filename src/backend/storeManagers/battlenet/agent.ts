import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

import { battleNetDriveC } from './prefix'
import { LOGS_DIR } from '../../config/paths'
import { runExe, stopWineProcesses } from '../../launcher/wineRunner'
import { BATTLENET_BOTTLE } from './constants'

const AGENT_VERSION_RE = /^Agent\.\d+$/i
/** Real Agent ~7 MB; root stub is typically ~600-650 KB. */
const MIN_AGENT_EXE_BYTES = 2_000_000

export type AgentMaintenanceOptions = {
  /** Wipe all of ProgramData/Battle.net (login cache + Agent). Use for deep repair. */
  deep?: boolean
  /** Start Agent.exe and wait (manual diagnostics only). */
  wake?: boolean
  /** Launch only: clean broken versions, do not touch product.db or start Agent. */
  launchOnly?: boolean
  /** Launch prep: prune + product.db + Agent.9464 before Battle.net.exe (avoids BLZBNTBNA00000005). */
  prepareLaunch?: boolean
  /** Restart Agent without killing Battle.net.exe (window already open with error). */
  wakeOnly?: boolean
  /** Blizzard installer running: Agent only, no wineserver -w or killing Setup.exe. */
  installAssist?: boolean
  logPath?: string
  log?: (line: string) => void
}

export type AgentMaintenanceResult = {
  pruned: string[]
  removedNewest: string | null
  productDb: boolean
  programData: boolean
  agentWake: string | null
}

function programDataBattleNet(bottleName: string): string {
  return join(battleNetDriveC(bottleName), 'ProgramData', 'Battle.net')
}

function logLine(
  opts: AgentMaintenanceOptions | undefined,
  line: string
): void {
  opts?.log?.(line)
  if (opts?.logPath) {
    mkdirSync(LOGS_DIR, { recursive: true })
    appendFileSync(opts.logPath, line + '\n')
  }
}

function agentExeIfValid(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return statSync(path).size >= MIN_AGENT_EXE_BYTES ? path : null
  } catch {
    return null
  }
}

function collectVersionedAgentExes(...baseDirs: string[]): string[] {
  const versionExes: string[] = []
  for (const baseDir of baseDirs) {
    if (!existsSync(baseDir)) continue
    try {
      for (const name of readdirSync(baseDir)) {
        if (!AGENT_VERSION_RE.test(name)) continue
        const exe = join(baseDir, name, 'Agent.exe')
        if (agentExeIfValid(exe)) versionExes.push(exe)
      }
    } catch {
      /* ignore */
    }
  }
  return versionExes
}

export function findAgentExe(bottleName = BATTLENET_BOTTLE): string | null {
  const pd = programDataBattleNet(bottleName)
  const agentRoot = join(pd, 'Agent')
  // Blizzard installer drops Agent.9464 in ProgramData/Battle.net/, not only in Agent/.
  const versionExes = collectVersionedAgentExes(agentRoot, pd)

  if (versionExes.length) {
    versionExes.sort()
    return versionExes[0]!
  }

  const driveC = battleNetDriveC(bottleName)
  for (const p of [
    join(agentRoot, 'Agent.exe'),
    join(pd, 'Agent.exe'),
    join(driveC, 'Program Files (x86)', 'Battle.net', 'Agent', 'Agent.exe')
  ]) {
    const valid = agentExeIfValid(p)
    if (valid) return valid
  }

  return null
}

/** Paths that Battle.net / the installer typically execute (stub ~600 KB vs real ~7 MB). */
export function battleNetAgentLaunchPaths(bottleName = BATTLENET_BOTTLE): string[] {
  const pd = programDataBattleNet(bottleName)
  const agentRoot = join(pd, 'Agent')
  return [join(agentRoot, 'Agent.exe'), join(pd, 'Agent.exe')]
}

export function ensureRootAgentExe(bottleName = BATTLENET_BOTTLE): string | null {
  const pd = programDataBattleNet(bottleName)
  const agentRoot = join(pd, 'Agent')
  mkdirSync(agentRoot, { recursive: true })
  const versioned = findAgentExe(bottleName)
  if (!versioned) {
    for (const p of battleNetAgentLaunchPaths(bottleName)) {
      const valid = agentExeIfValid(p)
      if (valid) return valid
    }
    return null
  }
  try {
    const verSize = statSync(versioned).size
    let primary: string | null = null
    for (const target of battleNetAgentLaunchPaths(bottleName)) {
      const cur = existsSync(target) ? statSync(target).size : 0
      if (cur < MIN_AGENT_EXE_BYTES || cur < verSize) {
        copyFileSync(versioned, target)
      }
      const valid = agentExeIfValid(target)
      if (valid && !primary) primary = valid
    }
    return primary ?? versioned
  } catch {
    return versioned
  }
}

/** @deprecated Use ensureRootAgentExe */
export function removeRootAgentStubIfVersioned(bottleName = BATTLENET_BOTTLE): boolean {
  const before = join(programDataBattleNet(bottleName), 'Agent', 'Agent.exe')
  const sizeBefore = existsSync(before) ? statSync(before).size : 0
  const after = ensureRootAgentExe(bottleName)
  if (!after) return false
  return sizeBefore < MIN_AGENT_EXE_BYTES && statSync(after).size >= MIN_AGENT_EXE_BYTES
}

export function stopBattleNetAgentProcesses(): void {
  for (const pattern of ['Battle.net/Agent/Agent.exe', 'Battle.net\\\\Agent\\\\Agent']) {
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

export function isBattleNetAgentProcessRunning(bottleName = BATTLENET_BOTTLE): boolean {
  const patterns = ['Battle.net/Agent/Agent.exe', 'ProgramData/Battle.net/Agent']
  for (const pattern of patterns) {
    try {
      const out = execSync(`pgrep -lf "${pattern}"`, {
        encoding: 'utf-8',
        timeout: 3000
      })
      if (/Agent\.exe/i.test(out)) return true
    } catch {
      /* try next */
    }
  }
  return false
}

function folderSize(path: string): number {
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
    walk(path)
  } catch {
    /* ignore */
  }
  return total
}

function pruneBrokenAgentVersionsInDir(baseDir: string): string[] {
  if (!existsSync(baseDir)) return []
  const removed: string[] = []
  try {
    for (const name of readdirSync(baseDir)) {
      if (!AGENT_VERSION_RE.test(name)) continue
      const dir = join(baseDir, name)
      const exe = join(dir, 'Agent.exe')
      const exeBytes = existsSync(exe) ? statSync(exe).size : 0
      const broken =
        !existsSync(exe) ||
        exeBytes < MIN_AGENT_EXE_BYTES ||
        folderSize(dir) < 200_000
      if (broken) {
        rmSync(dir, { recursive: true, force: true })
        removed.push(name)
      }
    }
  } catch {
    /* ignore */
  }
  return removed
}

export function pruneBrokenAgentVersions(bottleName = BATTLENET_BOTTLE): string[] {
  const pd = programDataBattleNet(bottleName)
  return [
    ...pruneBrokenAgentVersionsInDir(join(pd, 'Agent')),
    ...pruneBrokenAgentVersionsInDir(pd)
  ]
}

/** If multiple Agent.XXXX versions exist, remove the newest (typically the broken one under Wine). */
function pruneNewestAgentVersionInDir(baseDir: string): string | null {
  if (!existsSync(baseDir)) return null
  let versions: string[] = []
  try {
    versions = readdirSync(baseDir)
      .filter((n) => AGENT_VERSION_RE.test(n))
      .sort()
  } catch {
    return null
  }
  if (versions.length < 2) return null
  const newest = versions[versions.length - 1]!
  try {
    rmSync(join(baseDir, newest), { recursive: true, force: true })
    return newest
  } catch {
    return null
  }
}

export function pruneNewestAgentVersionIfMultiple(
  bottleName = BATTLENET_BOTTLE
): string | null {
  const pd = programDataBattleNet(bottleName)
  return (
    pruneNewestAgentVersionInDir(join(pd, 'Agent')) ??
    pruneNewestAgentVersionInDir(pd)
  )
}

export function isAgentLaunchReady(bottleName = BATTLENET_BOTTLE): boolean {
  return findAgentExe(bottleName) !== null
}

/** Waits for Battle.net to download a valid Agent.XXXX after starting the stub. */
export async function waitForValidAgent(
  bottleName = BATTLENET_BOTTLE,
  options?: { timeoutMs?: number; log?: (line: string) => void }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 90_000
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const exe = ensureRootAgentExe(bottleName) ?? findAgentExe(bottleName)
    if (exe) return exe
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

export function resetBattleNetAgentProductDb(bottleName = BATTLENET_BOTTLE): boolean {
  const db = join(programDataBattleNet(bottleName), 'Agent', 'product.db')
  if (!existsSync(db)) return false
  try {
    rmSync(db)
    return true
  } catch {
    return false
  }
}

/** Clears cache/login without removing Agent.XXXX or the client in Program Files. */
export function resetBattleNetProgramData(bottleName = BATTLENET_BOTTLE): boolean {
  const root = programDataBattleNet(bottleName)
  if (!existsSync(root)) return false
  let changed = false
  const cacheDirs = ['data', 'Logs', 'Cache', 'cache']
  for (const name of cacheDirs) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    try {
      rmSync(p, { recursive: true, force: true })
      changed = true
    } catch {
      /* ignore */
    }
  }
  if (resetBattleNetAgentProductDb(bottleName)) changed = true
  ensureRootAgentExe(bottleName)
  return changed
}

/**
 * Automated Agent maintenance (no manual folder edits needed).
 * Launch: light + wake. Repair: deep (ProgramData) + prune.
 */
export async function maintainBattleNetAgent(
  bottleName = BATTLENET_BOTTLE,
  options: AgentMaintenanceOptions = {}
): Promise<AgentMaintenanceResult> {
  const result: AgentMaintenanceResult = {
    pruned: [],
    removedNewest: null,
    productDb: false,
    programData: false,
    agentWake: null
  }

  if (options.prepareLaunch) {
    logLine(options, 'Preparing Battle.net Agent (BLZBNTBNA00000005)...')
  } else if (!options.launchOnly && !options.wakeOnly) {
    logLine(options, 'Battle.net Agent maintenance...')
  }
  if (options.installAssist) {
    stopBattleNetAgentProcesses()
    await new Promise((r) => setTimeout(r, 800))
  } else if (options.wakeOnly) {
    stopBattleNetAgentProcesses()
    await new Promise((r) => setTimeout(r, 1500))
  } else {
    // Deep repair: wait for clean shutdown. Launch: -k only to avoid hanging if client is still open.
    stopWineProcesses(bottleName, { wait: Boolean(options.deep) })
  }

  if (options.deep) {
    result.programData = resetBattleNetProgramData(bottleName)
    if (result.programData) {
      logLine(options, 'ProgramData/Battle.net cache cleared (deep repair)')
    }
  }

  result.pruned = pruneBrokenAgentVersions(bottleName)
  if (result.pruned.length) {
    logLine(options, `Agent: removed broken versions: ${result.pruned.join(', ')}`)
  }

  if (!options.installAssist) {
    result.removedNewest = pruneNewestAgentVersionIfMultiple(bottleName)
  }
  if (result.removedNewest) {
    logLine(
      options,
      `Agent: removed suspect newest version (${result.removedNewest}); Battle.net will prompt to update`
    )
  }

  if (options.prepareLaunch || options.wakeOnly) {
    const root = ensureRootAgentExe(bottleName)
    if (root) {
      logLine(options, `Agent: ${root.split(/[/\\]/).slice(-3).join('/')}`)
    }
  }

  const shouldResetDb =
    options.deep || options.prepareLaunch || options.wake || options.installAssist
  if (shouldResetDb && !options.launchOnly) {
    result.productDb = resetBattleNetAgentProductDb(bottleName)
    if (result.productDb) {
      logLine(options, 'Agent: product.db reset')
    }
  }

  const shouldWake =
    options.wake || options.prepareLaunch || options.wakeOnly || options.installAssist
  if (shouldWake) {
    let agent = ensureRootAgentExe(bottleName) ?? findAgentExe(bottleName)
    const agentRoot = join(programDataBattleNet(bottleName), 'Agent')
    const rootStub = join(agentRoot, 'Agent.exe')

    if (!agent && existsSync(rootStub)) {
      logLine(options, 'Agent stub: starting Blizzard updater...')
      runExe(bottleName, rootStub, { battleNetEnv: true, logPath: options.logPath })
      agent = await waitForValidAgent(bottleName, {
        timeoutMs: 90_000,
        log: (line) => logLine(options, line)
      })
      if (agent) {
        ensureRootAgentExe(bottleName)
        logLine(options, 'Agent downloaded successfully')
      }
    }

    if (!agent) {
      logLine(options, 'Agent.exe not found — complete the installation or click Repair')
    } else {
      runExe(bottleName, agent, { battleNetEnv: true, logPath: options.logPath })
      logLine(options, 'Agent.exe started, waiting...')
      const waitMs = options.prepareLaunch ? 12_000 : options.installAssist ? 6_000 : 4_000
      await new Promise((r) => setTimeout(r, waitMs))
      if (!isBattleNetAgentProcessRunning(bottleName) && options.prepareLaunch) {
        logLine(options, 'Waiting for Agent after start...')
        const ready = await waitForValidAgent(bottleName, {
          timeoutMs: 60_000,
          log: (line) => logLine(options, line)
        })
        if (ready) ensureRootAgentExe(bottleName)
      }
      if (isBattleNetAgentProcessRunning(bottleName)) {
        logLine(options, 'Agent running')
      } else {
        logLine(options, 'Warning: Agent not detected after start — will retry on open')
      }
      result.agentWake = ensureRootAgentExe(bottleName) ?? agent
    }
  }

  return result
}

/** @deprecated Use maintainBattleNetAgent */
export function repairBattleNetAgent(bottleName = BATTLENET_BOTTLE) {
  stopWineProcesses(bottleName, { wait: true })
  return {
    pruned: pruneBrokenAgentVersions(bottleName),
    productDb: resetBattleNetAgentProductDb(bottleName),
    programData: false
  }
}

/** @deprecated Use maintainBattleNetAgent({ wake: true }) */
export async function wakeBattleNetAgent(
  bottleName = BATTLENET_BOTTLE,
  logPath?: string
): Promise<{ ok: boolean; message: string }> {
  const r = await maintainBattleNetAgent(bottleName, { wake: true, logPath })
  if (!r.agentWake && !findAgentExe(bottleName)) {
    return { ok: false, message: 'Agent.exe not found' }
  }
  return { ok: true, message: 'Agent prepared automatically' }
}
