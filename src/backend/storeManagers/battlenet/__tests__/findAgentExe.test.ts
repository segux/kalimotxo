import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

jest.mock('../../../bottle', () => ({
  getBottlePath: (name: string) => join(global.__AGENT_TEST_ROOT__, name)
}))

declare global {
  // eslint-disable-next-line no-var
  var __AGENT_TEST_ROOT__: string
}

import {
  ensureRootAgentExe,
  findAgentExe,
  pruneBrokenAgentVersions
} from '../agent'

const BOTTLE = 'Battle.net'

beforeEach(() => {
  global.__AGENT_TEST_ROOT__ = mkdtempSync(join(tmpdir(), 'agent-exe-'))
})

afterEach(() => {
  rmSync(global.__AGENT_TEST_ROOT__, { recursive: true, force: true })
})

describe('findAgentExe', () => {
  it('prefers Agent.9464 over small root stub', () => {
    const agentRoot = join(
      global.__AGENT_TEST_ROOT__,
      BOTTLE,
      'drive_c',
      'ProgramData',
      'Battle.net',
      'Agent'
    )
    mkdirSync(join(agentRoot, 'Agent.9464'), { recursive: true })
    writeFileSync(join(agentRoot, 'Agent.exe'), Buffer.alloc(600_000))
    writeFileSync(join(agentRoot, 'Agent.9464', 'Agent.exe'), Buffer.alloc(2_000_000))

    const exe = findAgentExe(BOTTLE)
    expect(exe).toContain('Agent.9464')
    expect(exe).toContain('Agent.exe')
    expect(existsSync(exe!)).toBe(true)
  })

  it('finds Agent.XXXX next to Agent/ (Blizzard installer layout)', () => {
    const pd = join(
      global.__AGENT_TEST_ROOT__,
      BOTTLE,
      'drive_c',
      'ProgramData',
      'Battle.net'
    )
    mkdirSync(join(pd, 'Agent.9464'), { recursive: true })
    writeFileSync(join(pd, 'Agent.9464', 'Agent.exe'), Buffer.alloc(2_500_000))
    writeFileSync(join(pd, 'Agent.exe'), Buffer.alloc(600_000))

    const exe = findAgentExe(BOTTLE)
    expect(exe).toContain('Agent.9464')
    const root = ensureRootAgentExe(BOTTLE)!
    expect(statSync(root).size).toBeGreaterThanOrEqual(2_000_000)
    expect(statSync(join(pd, 'Agent.exe')).size).toBeGreaterThanOrEqual(2_000_000)
    expect(statSync(join(pd, 'Agent', 'Agent.exe')).size).toBeGreaterThanOrEqual(2_000_000)
  })

  it('prefers newest valid Agent.XXXX when several exist', () => {
    const agentRoot = join(
      global.__AGENT_TEST_ROOT__,
      BOTTLE,
      'drive_c',
      'ProgramData',
      'Battle.net',
      'Agent'
    )
    mkdirSync(join(agentRoot, 'Agent.9000'), { recursive: true })
    mkdirSync(join(agentRoot, 'Agent.9124'), { recursive: true })
    writeFileSync(join(agentRoot, 'Agent.9000', 'Agent.exe'), Buffer.alloc(2_100_000))
    writeFileSync(join(agentRoot, 'Agent.9124', 'Agent.exe'), Buffer.alloc(2_200_000))

    const exe = findAgentExe(BOTTLE)
    expect(exe).toContain('Agent.9124')
  })

  it('compares versions numerically across Agent/ and the ProgramData root', () => {
    const pd = join(global.__AGENT_TEST_ROOT__, BOTTLE, 'drive_c', 'ProgramData', 'Battle.net')
    mkdirSync(join(pd, 'Agent', 'Agent.9464'), { recursive: true })
    mkdirSync(join(pd, 'Agent.9700'), { recursive: true })
    mkdirSync(join(pd, 'Agent.9775'), { recursive: true })
    writeFileSync(join(pd, 'Agent', 'Agent.9464', 'Agent.exe'), Buffer.alloc(2_100_000))
    writeFileSync(join(pd, 'Agent.9700', 'Agent.exe'), Buffer.alloc(2_200_000))
    writeFileSync(join(pd, 'Agent.9775', 'Agent.exe'), Buffer.alloc(2_150_000))

    expect(findAgentExe(BOTTLE)).toContain('Agent.9775')
  })

  it('ensureRootAgentExe never downgrades a newer root Agent.exe by size', () => {
    const pd = join(global.__AGENT_TEST_ROOT__, BOTTLE, 'drive_c', 'ProgramData', 'Battle.net')
    mkdirSync(join(pd, 'Agent.9700'), { recursive: true })
    mkdirSync(join(pd, 'Agent.9775'), { recursive: true })
    writeFileSync(join(pd, 'Agent.9700', 'Agent.exe'), Buffer.alloc(2_500_000, 1))
    // The newer build is smaller: the old size heuristic copied 9700 over it.
    writeFileSync(join(pd, 'Agent.9775', 'Agent.exe'), Buffer.alloc(2_400_000, 2))
    writeFileSync(join(pd, 'Agent.exe'), Buffer.alloc(2_400_000, 2))

    ensureRootAgentExe(BOTTLE)
    expect(statSync(join(pd, 'Agent.exe')).size).toBe(2_400_000)
    expect(statSync(join(pd, 'Agent', 'Agent.exe')).size).toBe(2_400_000)
  })

  it('pruneBrokenAgentVersions removes version folder with stub Agent.exe', () => {
    const agentRoot = join(
      global.__AGENT_TEST_ROOT__,
      BOTTLE,
      'drive_c',
      'ProgramData',
      'Battle.net',
      'Agent'
    )
    mkdirSync(join(agentRoot, 'Agent.9124'), { recursive: true })
    writeFileSync(join(agentRoot, 'Agent.9124', 'Agent.exe'), Buffer.alloc(600_000))

    const removed = pruneBrokenAgentVersions(BOTTLE)
    expect(removed).toContain('Agent.9124')
    expect(existsSync(join(agentRoot, 'Agent.9124'))).toBe(false)
  })

  it('ensureRootAgentExe replaces root stub with versioned binary', () => {
    const agentRoot = join(
      global.__AGENT_TEST_ROOT__,
      BOTTLE,
      'drive_c',
      'ProgramData',
      'Battle.net',
      'Agent'
    )
    mkdirSync(join(agentRoot, 'Agent.9464'), { recursive: true })
    writeFileSync(join(agentRoot, 'Agent.exe'), Buffer.alloc(600_000))
    writeFileSync(join(agentRoot, 'Agent.9464', 'Agent.exe'), Buffer.alloc(2_500_000))

    const root = ensureRootAgentExe(BOTTLE)!
    expect(root).toContain(`${join('Agent', 'Agent.exe')}`)
    expect(existsSync(root)).toBe(true)
    const { statSync } = require('fs')
    expect(statSync(root).size).toBeGreaterThanOrEqual(2_000_000)
  })
})
