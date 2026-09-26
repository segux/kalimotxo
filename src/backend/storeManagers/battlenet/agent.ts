import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs'
import { execSync } from 'child_process'
import net from 'net'
import { join } from 'path'

import { battleNetDriveC } from './prefix'
import { LOGS_DIR } from '../../config/paths'
import { runExe, stopWineProcesses } from '../../launcher/wineRunner'
import { BATTLENET_BOTTLE } from './constants'
import { readAgentPort } from './agentPortBridge'
import { isAgentRunning } from './processes'

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
  if (opts?.log) {
    // The callback usually writes to the same file; avoid duplicate lines.
    opts.log(line)
  } else if (opts?.logPath) {
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

function agentVersionOf(exePath: string): number {
  const m = /Agent\.(\d+)[\\/]Agent\.exe$/i.exec(exePath)
  return m ? Number(m[1]) : 0
}

function filesDiffer(a: string, b: string): boolean {
  try {
    if (!existsSync(b)) return true
    if (statSync(a).size !== statSync(b).size) return true
    return !readFileSync(a).equals(readFileSync(b))
  } catch {
    return true
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
    // Newest valid version: running an older Agent makes it fire "update agent
    // event" and restart itself on every launch, which drops the client session.
    versionExes.sort((a, b) => agentVersionOf(b) - agentVersionOf(a))
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
    let primary: string | null = null
    for (const target of battleNetAgentLaunchPaths(bottleName)) {
      // Keep the launch paths in sync with the newest version (never downgrade).
      if (filesDiffer(versioned, target)) {
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

export function isBattleNetAgentProcessRunning(_bottleName = BATTLENET_BOTTLE): boolean {
  return isAgentRunning()
}

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(500, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/**
 * Polls until the Agent accepts connections on the port from `Agent.dat`.
 * Replaces a fixed sleep: the Agent is usually ready in a few seconds.
 */
export async function waitForAgentListening(
  bottleName = BATTLENET_BOTTLE,
  timeoutMs = 20_000
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const port = readAgentPort(bottleName)
    if (port && (await portAcceptsConnections(port))) return true
    await new Promise((r) => setTimeout(r, 500))
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

/**
 * If multiple Agent.XXXX versions exist AND the newest is broken (no valid exe),
 * remove it so Battle.net falls back to the last known-good version.
 * A valid newest version (e.g. a real auto-update) is kept — removing it would
 * force the client into an update loop on every launch.
 */
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
  const newestDir = join(baseDir, newest)
  const newestExe = join(newestDir, 'Agent.exe')
  const exeBytes = existsSync(newestExe) ? statSync(newestExe).size : 0
  const isBroken =
    !existsSync(newestExe) || exeBytes < MIN_AGENT_EXE_BYTES || folderSize(newestDir) < 200_000
  if (!isBroken) return null
  try {
    rmSync(newestDir, { recursive: true, force: true })
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
  } else if (!options.prepareLaunch) {
    // Deep repair: wait for clean shutdown. Launch skips this: launch() already
    // stopped Wine, and a second kill forces another wineserver cold start.
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

  // Do NOT reset product.db on a normal launch (prepareLaunch). Without it
  // the Agent fires "update agent event" on every startup, gets a 404 from the
  // version server, and crashes when trying to restart itself. Reset only on
  // explicit repair (deep) or installation flows.
  const shouldResetDb = options.deep || options.wake || options.installAssist
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
      if (options.prepareLaunch) {
        const t0 = Date.now()
        const listening = await waitForAgentListening(bottleName, 20_000)
        logLine(
          options,
          listening
            ? `Agent listening after ${Date.now() - t0} ms`
            : 'Agent not listening after 20 s'
        )
      } else {
        await new Promise((r) => setTimeout(r, options.installAssist ? 6_000 : 4_000))
      }
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
