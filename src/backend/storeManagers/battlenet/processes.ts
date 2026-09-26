import { execFileSync } from 'child_process'

/**
 * Process detection for the Battle.net Wine tree.
 *
 * Wine rewrites the process title to the Windows path once the exe is loaded
 * (e.g. `C:\ProgramData\Battle.net\Agent\Agent.exe`), so Unix-path `pgrep`
 * patterns miss running processes. We read `ps` once and match both forms.
 */

export type ProcessEntry = { pid: number; command: string }

const AGENT_RE = /ProgramData[\\/]Battle\.net[\\/](?:Agent[\\/])?(?:Agent\.\d+[\\/])?Agent\.exe/i
const CLIENT_RE = /Battle\.net\.exe/i
const CEF_CHILD_RE = /--type=/
const CEF_RENDERER_RE = /--type=renderer/

export function listProcesses(): ProcessEntry[] {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf-8',
      timeout: 3000,
      maxBuffer: 16 * 1024 * 1024
    })
    const entries: ProcessEntry[] = []
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line)
      if (m) entries.push({ pid: Number(m[1]), command: m[2]! })
    }
    return entries
  } catch {
    return []
  }
}

export function isAgentRunning(procs: ProcessEntry[] = listProcesses()): boolean {
  return procs.some((p) => AGENT_RE.test(p.command))
}

/** Main Battle.net.exe process (not its CEF children or the `start.exe` wrapper). */
export function isClientRunning(procs: ProcessEntry[] = listProcesses()): boolean {
  return procs.some(
    (p) =>
      CLIENT_RE.test(p.command) &&
      !CEF_CHILD_RE.test(p.command) &&
      !/start\.exe/i.test(p.command)
  )
}

/** Any client process, including the `start.exe` wrapper before Wine renames it. */
export function isClientStarting(procs: ProcessEntry[] = listProcesses()): boolean {
  return procs.some((p) => CLIENT_RE.test(p.command))
}

/** A CEF renderer exists once the client has created its window and web view. */
export function isClientUiReady(procs: ProcessEntry[] = listProcesses()): boolean {
  return procs.some((p) => CLIENT_RE.test(p.command) && CEF_RENDERER_RE.test(p.command))
}
