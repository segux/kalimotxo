import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { DXMT_DIR, RUNTIME_DIR } from '../config/paths'
import { resolveWineExternalDir } from './wineEnv'
import type { WineInstallation } from './types'

/**
 * How DXMT reaches a game, whoever starts it (Kalimotxo or Battle.net's Play):
 *
 * Wine takes builtin DLLs from its own `lib/wine` before `WINEDLLPATH`, and
 * swaps any builtin-marked DLL it finds elsewhere for its own, so DXMT on
 * `WINEDLLPATH` never replaced Wine's d3d11/dxgi: DXMT games ran on wined3d
 * (Vulkan -> MoltenVK) and D2R crashed in MoltenVK when loading into a game.
 *
 * - `winemetal.dll`/`winemetal.so` (DXMT's bridge to Metal, the only part that
 *   needs Wine's unix side) are added to the Wine install. Wine ships no file
 *   by that name, so nothing else changes for Battle.net or other games.
 * - DXMT's `d3d11`, `dxgi` and `d3d10core` only import Windows DLLs and
 *   `winemetal.dll`: they are copied next to the game's .exe without Wine's
 *   builtin marker, and load as native for that exe through its
 *   `AppDefaults\<exe>\DllOverrides` (gameDefaults.ts) or WINEDLLOVERRIDES.
 */

/** DXMT DLLs that load as native from the game's folder. */
export const DXMT_NATIVE_DLLS = ['d3d11', 'dxgi', 'd3d10core'] as const

const BUILTIN_SIGNATURE = 'Wine builtin DLL'
const SIGNATURE_OFFSET = 0x40

type ArchDir = 'x86_64-windows' | 'i386-windows'

/** A DXMT release: the dir holding `x86_64-windows`, `i386-windows`, `x86_64-unix`. */
function isDxmtRoot(dir: string): boolean {
  return (
    existsSync(join(dir, 'x86_64-windows', 'd3d11.dll')) &&
    existsSync(join(dir, 'x86_64-windows', 'winemetal.dll')) &&
    existsSync(join(dir, 'x86_64-unix', 'winemetal.so'))
  )
}

/** DXMT bundled with the Wine (`lib/external/dxmt`), else `runtime/dxmt[/<version>]`. */
export function resolveDxmtRoot(installation: WineInstallation): string | null {
  const candidates: string[] = []
  const ext = resolveWineExternalDir(installation)
  if (ext) candidates.push(join(ext, 'dxmt'))
  candidates.push(DXMT_DIR)
  try {
    for (const name of readdirSync(DXMT_DIR).sort().reverse()) candidates.push(join(DXMT_DIR, name))
  } catch {
    /* no runtime/dxmt */
  }
  return candidates.find(isDxmtRoot) ?? null
}

/** A copy of a Wine builtin DLL that Wine loads as a native one. */
export function asNativeDll(dll: Buffer): Buffer {
  const out = Buffer.from(dll)
  const end = SIGNATURE_OFFSET + BUILTIN_SIGNATURE.length
  if (out.toString('latin1', SIGNATURE_OFFSET, end) === BUILTIN_SIGNATURE) {
    out.fill(0, SIGNATURE_OFFSET, end)
  }
  return out
}

/** Windows DLL dir matching a PE's machine (x64 / x86), null if not a PE. */
export function peArchDir(pe: Buffer): ArchDir | null {
  if (pe.length < 0x40 || pe.toString('latin1', 0, 2) !== 'MZ') return null
  const lfanew = pe.readUInt32LE(0x3c)
  if (lfanew + 6 > pe.length || pe.toString('latin1', lfanew, lfanew + 4) !== 'PE\0\0') return null
  const machine = pe.readUInt16LE(lfanew + 4)
  if (machine === 0x8664) return 'x86_64-windows'
  if (machine === 0x14c) return 'i386-windows'
  return null
}

function readHeader(path: string): Buffer {
  const buf = readFileSync(path)
  return buf.subarray(0, Math.min(buf.length, 4096))
}

/** Writes `data` to `dest` unless it already holds it. Returns whether it wrote. */
function writeIfChanged(dest: string, data: Buffer): boolean {
  try {
    if (readFileSync(dest).equals(data)) return false
  } catch {
    /* missing */
  }
  mkdirSync(dirname(dest), { recursive: true })
  // Replace rather than overwrite: never write through a (hard) link.
  rmSync(dest, { force: true })
  writeFileSync(dest, data)
  return true
}

/** Adds DXMT's winemetal (DLLs + unix lib) to the Wine at `wineRoot`. */
export function installWinemetal(wineRoot: string, dxmtRoot: string): string[] {
  const changed: string[] = []
  const files: [string, string][] = [
    ['x86_64-windows', 'winemetal.dll'],
    ['i386-windows', 'winemetal.dll'],
    ['x86_64-unix', 'winemetal.so']
  ]
  for (const [sub, name] of files) {
    const from = join(dxmtRoot, sub, name)
    if (!existsSync(from)) continue
    const to = join(wineRoot, 'lib', 'wine', sub, name)
    if (!existsSync(dirname(to))) continue
    if (writeIfChanged(to, readFileSync(from))) changed.push(`${sub}/${name}`)
  }
  return changed
}

/** Copies DXMT's D3D DLLs, as native DLLs, next to `exe`. */
export function installDxmtNextToExe(exe: string, dxmtRoot: string): string[] {
  const arch = peArchDir(readHeader(exe))
  if (!arch) throw new Error(`not a Windows executable: ${exe}`)
  const changed: string[] = []
  for (const dll of DXMT_NATIVE_DLLS) {
    const from = join(dxmtRoot, arch, `${dll}.dll`)
    if (!existsSync(from)) throw new Error(`DXMT ${arch}/${dll}.dll missing`)
    if (writeIfChanged(join(dirname(exe), `${dll}.dll`), asNativeDll(readFileSync(from)))) {
      changed.push(`${dll}.dll`)
    }
  }
  return changed
}

/** Whether `file` is one of DXMT's own DLLs (they import winemetal.dll; no game ships that). */
function importsWinemetal(file: string): boolean {
  try {
    return readFileSync(file).includes('winemetal.dll')
  } catch {
    return false
  }
}

/**
 * Removes the DXMT DLLs Kalimotxo put next to `exe` when the game no longer
 * uses DXMT (its graphics layer changed), so Wine's own D3D is not shadowed
 * by leftovers. Only DXMT's own set is touched: d3d11/dxgi import
 * winemetal.dll, and d3d10core goes with a DXMT d3d11 (it calls into it).
 */
export function removeStaleDxmtNextToExe(exe: string, log?: (m: string) => void): string[] {
  const dir = dirname(exe)
  const d3d11 = join(dir, 'd3d11.dll')
  if (!importsWinemetal(d3d11)) return []
  const removed: string[] = []
  for (const dll of DXMT_NATIVE_DLLS) {
    const file = join(dir, `${dll}.dll`)
    if (!existsSync(file)) continue
    if (dll === 'd3d10core' || importsWinemetal(file)) {
      rmSync(file, { force: true })
      removed.push(`${dll}.dll`)
    }
  }
  if (removed.length) log?.(`DXMT: removed stale ${removed.join(', ')} next to ${exe.split(/[/\\]/).pop()}`)
  return removed
}

/**
 * Makes DXMT available to `exe` (see above). Returns false, logging why, when
 * DXMT is not installed or the Wine layout is unknown: the game then runs on
 * Wine's own D3D.
 */
export function ensureDxmtForExe(
  installation: WineInstallation,
  exe: string,
  log?: (m: string) => void
): boolean {
  // An earlier approach kept a DXMT copy of the whole Wine here.
  rmSync(join(RUNTIME_DIR, 'wine-dxmt'), { recursive: true, force: true })

  const wineRoot = dirname(dirname(installation.bin))
  const dxmtRoot = resolveDxmtRoot(installation)
  if (!dxmtRoot || !existsSync(join(wineRoot, 'lib', 'wine'))) {
    log?.(`DXMT unavailable (${!dxmtRoot ? 'DXMT not installed' : 'unknown Wine layout'})`)
    return false
  }
  try {
    const wine = installWinemetal(wineRoot, dxmtRoot)
    if (wine.length) log?.(`DXMT: added ${wine.join(', ')} to Wine`)
    const game = installDxmtNextToExe(exe, dxmtRoot)
    if (game.length) log?.(`DXMT: installed ${game.join(', ')} next to ${exe.split(/[/\\]/).pop()}`)
    return true
  } catch (e) {
    log?.(`DXMT unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
