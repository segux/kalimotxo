import { spawn } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import net from 'net'
import { join } from 'path'

import { DATA_DIR } from '../../config/paths'
import { logInfo } from '../../logger'
import { agentDatPath, startAgentPortBridge, stopAgentPortBridge } from './agentPortBridge'
import { BATTLENET_BOTTLE } from './constants'

/**
 * Detached 1120 -> Agent.dat bridge.
 *
 * The in-process bridge (agentPortBridge.ts) dies with Kalimotxo, so quitting
 * the app while Battle.net is open cuts the client off from its Agent
 * ("reconnect" banner, and eventually a lost session). This runs the same
 * bridge in a detached Node process (Electron with ELECTRON_RUN_AS_NODE) that
 * outlives the app and exits once no Battle.net process is left.
 *
 * Args: <Agent.dat path> <listen port>
 */
export const AGENT_BRIDGE_DAEMON_SOURCE = String.raw`'use strict'
const net = require('net')
const fs = require('fs')
const { execFileSync } = require('child_process')

const datPath = process.argv[2]
const listenPort = Number(process.argv[3]) || 1120
const CONNECT_RETRY_MS = 250
const CONNECT_DEADLINE_MS = 10000
const IDLE_CHECK_MS = Number(process.env.KALIMOTXO_BRIDGE_IDLE_CHECK_MS) || 15000
const IDLE_CHECKS_BEFORE_EXIT = 4

function agentPort() {
  try {
    const port = parseInt(fs.readFileSync(datPath, 'utf8').trim(), 10)
    return port > 0 && port < 65536 ? port : null
  } catch (e) {
    return null
  }
}

function connectUpstream(client, deadline) {
  const port = agentPort()
  const retry = () => {
    if (client.destroyed) return
    if (Date.now() > deadline) return client.destroy()
    setTimeout(() => connectUpstream(client, deadline), CONNECT_RETRY_MS)
  }
  if (!port) return retry()
  const upstream = net.connect({ host: '127.0.0.1', port })
  upstream.once('connect', () => {
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
    client.pipe(upstream)
    upstream.pipe(client)
    client.resume()
  })
  upstream.once('error', () => {
    upstream.destroy()
    retry()
  })
}

const server = net.createServer((client) => {
  client.pause()
  client.on('error', () => client.destroy())
  connectUpstream(client, Date.now() + CONNECT_DEADLINE_MS)
})
// Port taken: another bridge (or an Agent that binds 1120 itself) is serving.
server.on('error', () => process.exit(0))
server.listen(listenPort, '127.0.0.1')

let idleChecks = 0
setInterval(() => {
  let out = ''
  try {
    out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 3000 })
  } catch (e) {
    return
  }
  // Match the Wine processes only. Our own command line contains the
  // ProgramData/Battle.net path (Agent.dat), so matching paths kept us alive.
  const others = out.split('\n').filter((l) => parseInt(l, 10) !== process.pid)
  if (others.some((l) => /Battle\.net\.exe|Agent\.exe/i.test(l))) idleChecks = 0
  else if (++idleChecks >= IDLE_CHECKS_BEFORE_EXIT) process.exit(0)
}, IDLE_CHECK_MS)
`

const AGENT_FIXED_PORT = 1120

function writeDaemonScript(): string {
  const dir = join(DATA_DIR, 'bin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'agent-bridge.cjs')
  writeFileSync(path, AGENT_BRIDGE_DAEMON_SOURCE)
  return path
}

function portIsListening(port: number): Promise<boolean> {
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
 * Ensures something serves 127.0.0.1:1120 for the Battle.net client, preferring
 * the detached daemon. Falls back to the in-process bridge if it cannot start.
 */
export async function ensureAgentBridge(bottleName = BATTLENET_BOTTLE): Promise<void> {
  // A bridge that survives app restarts may already be up.
  if (await portIsListening(AGENT_FIXED_PORT)) return

  stopAgentPortBridge()
  try {
    const script = writeDaemonScript()
    const child = spawn(
      process.execPath,
      [script, agentDatPath(bottleName), String(AGENT_FIXED_PORT)],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }
    )
    child.unref()
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (await portIsListening(AGENT_FIXED_PORT)) {
        logInfo(`[agentBridge] detached bridge 1120 -> Agent.dat active (pid ${child.pid})`)
        return
      }
    }
    logInfo('[agentBridge] detached bridge did not come up — using in-process bridge')
  } catch (e) {
    logInfo(`[agentBridge] could not spawn detached bridge: ${String(e)}`)
  }
  startAgentPortBridge(bottleName)
}
