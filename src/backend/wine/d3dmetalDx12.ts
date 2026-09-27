import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'

import { getBundledDir } from '../config/bundled'
import { D3DMETAL_DIR } from '../config/paths'
import { isD3dmetalDx12Ready } from './d3dmetalSetup'
import type { WineInstallation } from './types'

/**
 * Runs a single DX12-only game (Diablo II: Resurrected) through Apple's real
 * D3DMetal, without touching Wine's own `d3d12.dll`/`dxgi.dll` builtins.
 *
 * D2R only speaks DirectX 12 (no `-dx11` switch exists; forcing DXMT, which
 * only translates DX11, made it fail with "Failed to initialize graphics
 * device" / D3D12CreateDevice never even attempted). Wine's own `d3d12.dll`,
 * compiled from CrossOver's open sources, uses vkd3d over MoltenVK, which
 * this exception reporter and D2R's own DX12 path do not get along with.
 * GPTK's own precompiled `d3d12.dll`/`dxgi.dll` are Apple's real D3DMetal
 * code and work — see `docs/battlenet-wine-problemas-y-roadmap.md`.
 *
 * The mechanism, scoped to the one exe that needs it:
 * - GPTK's `d3d12.dll`/`dxgi.dll` (imported into `D3DMETAL_DIR/dx12`, see
 *   `d3dmetalSetup.ts`) are added to the active Wine under unique names
 *   (`d3d12_d3dmetal.dll`/`dxgi_d3dmetal.dll`), so Wine's own builtins never
 *   change for Battle.net or any other game.
 * - Their unix side (`.so`) must be a symlink to one shared
 *   `libd3dshared.dylib`: it holds a table of Win32 callbacks that `dxgi`
 *   fills in and `d3d12` reads back, so two separate copies of the "same"
 *   library never see each other's state and `d3d12` crashes on a null
 *   pointer the first time it is used.
 * - A pair of tiny forwarder DLLs (our own code, checked into the repo, no
 *   Apple content) is copied over D2R's own `d3d12.dll`/`dxgi.dll`: Windows
 *   DLLs whose entire export table forwards to the renamed builtins above.
 *   Wine only consults them for `D2R.exe` itself (its own `AppDefaults`
 *   override), so nothing else is affected even from the same bottle.
 */

const DX12_DLLS = ['d3d12', 'dxgi'] as const

/** Writes `data` to `dest` unless it already holds it, never through a link. */
function writeIfChanged(dest: string, data: Buffer): boolean {
  try {
    if (readFileSync(dest).equals(data)) return false
  } catch {
    /* missing */
  }
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { force: true })
  writeFileSync(dest, data)
  return true
}

/**
 * Symlinks `dest` -> `target` (by name, same dir) unless it already is that
 * exact symlink. Must be a real symlink, not a copy: two separate files with
 * identical bytes still load as two separate instances (see file docstring).
 */
function symlinkIfChanged(dest: string, target: string): boolean {
  try {
    if (lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === target) {
      return false
    }
  } catch {
    /* missing, not a symlink, or unreadable: fall through to (re)create it */
  }
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { force: true })
  symlinkSync(target, dest)
  return true
}

/** Adds the renamed D3DMetal DX12 builtins to the Wine at `wineRoot`. */
export function installD3dmetalDx12Builtins(wineRoot: string): string[] {
  const dx12Root = join(D3DMETAL_DIR, 'dx12')
  const changed: string[] = []

  const sharedSrc = join(D3DMETAL_DIR, 'libd3dshared.dylib')
  const sharedDest = join(wineRoot, 'lib', 'wine', 'x86_64-unix', 'libd3dshared.dylib')
  if (existsSync(sharedSrc) && writeIfChanged(sharedDest, readFileSync(sharedSrc))) {
    changed.push('x86_64-unix/libd3dshared.dylib')
  }

  for (const dll of DX12_DLLS) {
    const pe = join(dx12Root, 'x86_64-windows', `${dll}.dll`)
    if (existsSync(pe)) {
      const to = join(wineRoot, 'lib', 'wine', 'x86_64-windows', `${dll}_d3dmetal.dll`)
      if (existsSync(dirname(to)) && writeIfChanged(to, readFileSync(pe))) {
        changed.push(`x86_64-windows/${dll}_d3dmetal.dll`)
      }
    }
    const unixDest = join(wineRoot, 'lib', 'wine', 'x86_64-unix', `${dll}_d3dmetal.so`)
    if (existsSync(sharedDest) && symlinkIfChanged(unixDest, 'libd3dshared.dylib')) {
      changed.push(`x86_64-unix/${dll}_d3dmetal.so`)
    }
  }
  return changed
}

/** Our own tiny forwarder DLLs (no Apple content): `d3d12.dll`/`dxgi.dll`
 *  whose exports all forward to `<name>_d3dmetal.dll`. See
 *  `scripts/wine/d3dmetal-forwarders/` for their source. */
function forwarderPath(dll: string): string {
  return join(getBundledDir(), 'd3dmetal-forwarders', `${dll}.dll`)
}

/** Copies the forwarder DLLs over `exe`'s own `d3d12.dll`/`dxgi.dll`. */
export function installD3dmetalDx12NextToExe(exe: string): string[] {
  const changed: string[] = []
  for (const dll of DX12_DLLS) {
    const from = forwarderPath(dll)
    if (!existsSync(from)) throw new Error(`forwarder ${dll}.dll missing from bundled resources`)
    if (writeIfChanged(join(dirname(exe), `${dll}.dll`), readFileSync(from))) {
      changed.push(`${dll}.dll`)
    }
  }
  return changed
}

/**
 * Makes real D3DMetal (DX12) available to `exe` alone. Returns false, logging
 * why, when GPTK's DX12 DLLs are not imported: the game then runs on Wine's
 * own `d3d12.dll` (vkd3d/MoltenVK), same as before this feature existed.
 */
export function ensureD3dmetalDx12ForExe(
  installation: WineInstallation,
  exe: string,
  log?: (m: string) => void
): boolean {
  if (!isD3dmetalDx12Ready()) {
    log?.('D3DMetal (DX12) unavailable: import Game Porting Toolkit first')
    return false
  }
  const wineRoot = dirname(dirname(installation.bin))
  if (!existsSync(join(wineRoot, 'lib', 'wine'))) {
    log?.('D3DMetal (DX12) unavailable: unknown Wine layout')
    return false
  }
  try {
    const wine = installD3dmetalDx12Builtins(wineRoot)
    if (wine.length) log?.(`D3DMetal (DX12): added ${wine.join(', ')} to Wine`)
    const game = installD3dmetalDx12NextToExe(exe)
    if (game.length) {
      log?.(`D3DMetal (DX12): installed ${game.join(', ')} next to ${exe.split(/[/\\]/).pop()}`)
    }
    return true
  } catch (e) {
    log?.(`D3DMetal (DX12) unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
