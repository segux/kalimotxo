import { closeSync, openSync, readSync, readdirSync, statSync, type Dirent } from 'fs'
import { basename, join, relative } from 'path'

import type { ExeCandidate, LibraryGraphicsBackend } from '../../common/types/library'

/** Directories under drive_c that never hold games. */
const SKIP_DIRS = new Set(['windows', 'programdata'])
const MAX_DEPTH = 7
const MAX_ENTRIES = 60_000

/** Helper executables that are never the game itself. */
const NOT_A_GAME_RE =
  /^(unins|uninstall|setup|install|downloader|vc_?redist|vcredist|dxsetup|dxwebsetup|dotnet|ndp\d|directx|oalinst|physx|ue\d?prereq|crashreport|crashhandler|unitycrashhandler|crashpad|cefsharp|qtwebengineprocess|7z|update|updater|patcher|eac|easyanticheat|battleye|redist)/i

/** All .exe files under `driveC` (except Windows dirs), with their sizes. */
export function snapshotExes(driveC: string): Map<string, number> {
  const out = new Map<string, number>()
  let visited = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_ENTRIES) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (++visited > MAX_ENTRIES) return
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth === 0 && SKIP_DIRS.has(e.name.toLowerCase())) continue
        walk(p, depth + 1)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.exe')) {
        try {
          out.set(p, statSync(p).size)
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(driveC, 0)
  return out
}

/**
 * The executables an installer added that can be the game, bigger first (the
 * game binary is usually the largest). Installers, downloaders, uninstallers
 * and runtime setups are never proposed: games are often installed through a
 * downloader that runs a second installer, and those were being offered.
 */
export function rankExeCandidates(
  before: Map<string, number>,
  after: Map<string, number>,
  driveC: string
): ExeCandidate[] {
  const added = [...after.entries()].filter(([p]) => !before.has(p))
  return added
    .filter(([path]) => !NOT_A_GAME_RE.test(basename(path)))
    .sort((a, b) => b[1] - a[1])
    .map(([path, size], i) => ({
      path,
      label: relative(driveC, path),
      size,
      suggested: i === 0
    }))
}

const SCAN_BYTES = 64 * 1024 * 1024

/**
 * Guesses the graphics layer from the Direct3D DLL names the executable
 * references: D3D12 -> D3DMetal, D3D11/10 -> DXMT, D3D9 and older -> wined3d.
 */
export function detectGraphicsBackend(exePath: string): LibraryGraphicsBackend {
  let text = ''
  let fd: number | null = null
  try {
    fd = openSync(exePath, 'r')
    const size = Math.min(statSync(exePath).size, SCAN_BYTES)
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    text = buf.toString('latin1').toLowerCase()
  } catch {
    return 'dxmt'
  } finally {
    if (fd !== null) closeSync(fd)
  }
  if (text.includes('d3d12.dll')) return 'd3dmetal'
  if (text.includes('d3d11.dll') || text.includes('d3d10')) return 'dxmt'
  if (/d3d9\.dll|d3d8\.dll|ddraw\.dll|opengl32\.dll/.test(text)) return 'wined3d'
  return 'dxmt'
}

/** "Setup_Some_Game_v1.2.exe" -> "Some Game". */
export function nameFromInstaller(installerPath: string): string {
  const cleaned = basename(installerPath)
    .replace(/\.(exe|msi)$/i, '')
    .replace(/^(setup|install(er)?)[\s_-]*/i, '')
    .replace(/[\s_-]*(setup|installer)$/i, '')
    .replace(/[\s_-]*v?\d+(\.\d+)+.*$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || basename(installerPath)
}

/** "…/Some Game/bin/SomeGame.exe" -> "SomeGame". */
export function nameFromExe(exePath: string): string {
  return basename(exePath).replace(/\.exe$/i, '')
}
