import { isAgentRunning, isClientRunning, isClientUiReady, type ProcessEntry } from '../processes'

// Command lines as `ps` shows them once Wine renames processes to their Windows path.
const AGENT = 'C:\\ProgramData\\Battle.net\\Agent\\Agent.exe OSLogRateLimit=64'
const AGENT_VERSIONED = 'C:\\ProgramData\\Battle.net\\Agent.9775\\Agent.exe --session=1'
const HELPER = 'C:\\ProgramData\\Battle.net_components\\battlenet_helpersvc\\AgentHelper.exe'
const START =
  'start.exe /exec /Users/me/.kalimotxo/bottles/Battle.net/drive_c/Program Files (x86)/Battle.net/Battle.net.exe --use-angle=vulkan'
const CLIENT =
  'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe --use-angle=vulkan --in-process-gpu OSLogRateLimit=64'
const RENDERER =
  'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe --type=renderer --log-severity=error'
const UTILITY =
  'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe --type=utility --utility-sub-type=network.mojom.NetworkService'

const procs = (...commands: string[]): ProcessEntry[] =>
  commands.map((command, i) => ({ pid: 100 + i, command }))

describe('Battle.net process detection', () => {
  it('detects the Agent by its Windows path', () => {
    expect(isAgentRunning(procs(AGENT))).toBe(true)
    expect(isAgentRunning(procs(AGENT_VERSIONED))).toBe(true)
    expect(isAgentRunning(procs(HELPER, CLIENT))).toBe(false)
  })

  it('detects the main client, not its wrapper or CEF children', () => {
    expect(isClientRunning(procs(CLIENT))).toBe(true)
    expect(isClientRunning(procs(START, RENDERER, UTILITY))).toBe(false)
  })

  it('reports the UI ready once a CEF renderer exists', () => {
    expect(isClientUiReady(procs(CLIENT, UTILITY))).toBe(false)
    expect(isClientUiReady(procs(CLIENT, RENDERER))).toBe(true)
  })
})
