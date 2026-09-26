import { spawn, type ChildProcess } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import net from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

jest.mock('../../../config/paths', () => ({ DATA_DIR: '/tmp/kalimotxo-test' }))
jest.mock('../agentPortBridge', () => ({
  agentDatPath: () => '',
  startAgentPortBridge: () => null,
  stopAgentPortBridge: () => {}
}))
jest.mock('../../../logger', () => ({ logInfo: () => {} }))

import { AGENT_BRIDGE_DAEMON_SOURCE } from '../agentBridgeDaemon'

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

async function waitListening(port: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port })
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('daemon did not listen')
}

describe('detached Agent bridge daemon', () => {
  let dir: string
  let daemon: ChildProcess | null = null
  let echo: net.Server | null = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-bridge-'))
  })

  afterEach(() => {
    daemon?.kill()
    echo?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('forwards to the port in Agent.dat, waiting for the Agent to come up', async () => {
    const script = join(dir, 'agent-bridge.cjs')
    const datPath = join(dir, 'Agent.dat')
    writeFileSync(script, AGENT_BRIDGE_DAEMON_SOURCE)
    const listenPort = await freePort()
    daemon = spawn(process.execPath, [script, datPath, String(listenPort)], { stdio: 'ignore' })
    await waitListening(listenPort)

    const reply = new Promise<string>((resolve, reject) => {
      const c = net.connect({ host: '127.0.0.1', port: listenPort }, () => c.write('hello'))
      let buf = ''
      c.on('data', (d) => {
        buf += d.toString()
        c.end()
      })
      c.on('end', () => resolve(buf))
      c.on('error', reject)
    })

    // Agent starts after the client connected, then writes its port.
    await new Promise((r) => setTimeout(r, 500))
    echo = net.createServer((s) => s.pipe(s))
    await new Promise<void>((r) => echo!.listen(0, '127.0.0.1', () => r()))
    writeFileSync(datPath, String((echo.address() as net.AddressInfo).port))

    expect(await reply).toBe('hello')
  }, 10_000)
})
