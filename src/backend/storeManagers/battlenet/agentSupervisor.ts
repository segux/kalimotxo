import { appendFileSync } from 'fs'
import { join } from 'path'

import { LOGS_DIR } from '../../config/paths'
import { runExe } from '../../launcher/wineRunner'
import { logInfo } from '../../logger'
import { ensureRootAgentExe, findAgentExe, waitForAgentListening } from './agent'
import { BATTLENET_BOTTLE } from './constants'
import { isAgentRunning, isClientRunning, listProcesses } from './processes'

/**
 * Keeps the Update Agent alive while the Battle.net client is open.
 *
 * On Windows the Agent is a persistent service. Under Wine it self-updates
 * (every few hours) by exiting and asking `C:\ProgramData\Battle.net\Agent.exe`
 * to start the new version, and that restart does not always come back. The
 * client is then left without an Agent: "reconnect" banner, and eventually the
 * session is dropped. We restart the newest Agent after a grace period that
 * leaves room for Blizzard's own restart.
 */

const TICK_MS = 8_000
/** Consecutive ticks without an Agent before restarting it (~24-32 s). */
const MISSING_TICKS_BEFORE_RESTART = 4
/** Consecutive ticks without a client before the supervisor stops itself. */
const IDLE_TICKS_BEFORE_STOP = 3
const RESTART_WINDOW_MS = 10 * 60_000
const MAX_RESTARTS_PER_WINDOW = 3

let timer: NodeJS.Timeout | null = null
let missingTicks = 0
let idleTicks = 0
let restarts: number[] = []
let busy = false

function log(line: string): void {
  logInfo(`[agentSupervisor] ${line}`)
  try {
    appendFileSync(join(LOGS_DIR, 'battlenet-launch.log'), `[agentSupervisor] ${line}\n`)
  } catch {
    /* ignore */
  }
}

async function tick(bottleName: string): Promise<void> {
  const procs = listProcesses()
  if (!isClientRunning(procs)) {
    if (++idleTicks >= IDLE_TICKS_BEFORE_STOP) stopAgentSupervisor()
    return
  }
  idleTicks = 0

  if (isAgentRunning(procs)) {
    missingTicks = 0
    return
  }
  if (++missingTicks < MISSING_TICKS_BEFORE_RESTART) return
  missingTicks = 0

  // Blizzard's own restart may be slow but already listening under another
  // process title: never start a second Agent next to it.
  if (await waitForAgentListening(bottleName, 1_000)) return

  const now = Date.now()
  restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS)
  if (restarts.length >= MAX_RESTARTS_PER_WINDOW) return
  restarts.push(now)

  const exe = ensureRootAgentExe(bottleName) ?? findAgentExe(bottleName)
  if (!exe) {
    log('Agent is gone and no valid Agent.exe was found')
    return
  }
  log(`Agent is gone while the client is open — restarting ${exe.split(/[/\\]/).slice(-2).join('/')}`)
  runExe(bottleName, exe, {
    battleNetEnv: true,
    logPath: join(LOGS_DIR, 'battlenet-launch.log')
  })
}

export function startAgentSupervisor(bottleName = BATTLENET_BOTTLE): void {
  if (timer) return
  missingTicks = 0
  idleTicks = 0
  timer = setInterval(() => {
    if (busy) return
    busy = true
    tick(bottleName)
      .catch((e) => log(`tick failed: ${String(e)}`))
      .finally(() => {
        busy = false
      })
  }, TICK_MS)
  timer.unref?.()
}

export function stopAgentSupervisor(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

export function isAgentSupervisorRunning(): boolean {
  return timer !== null
}
