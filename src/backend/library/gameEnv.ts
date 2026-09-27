import { spawnSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { getBottleConfig, getBottlePath } from '../bottle'
import { buildEnv, getActiveWineInstallation, getWineBinary } from '../launcher/wineRunner'
import { applyGraphicsEnv } from '../wine/graphicsBackend'
import { applyMacGameStack, mergeDllOverrides, setupWineEnvVars } from '../wine/wineEnv'
import type { LibraryGraphicsBackend } from '../../common/types/library'

/**
 * DLL overrides per graphics layer. DXMT's D3D/DXGI DLLs sit next to the
 * game's exe and load as native (see wine/dxmt.ts); D3DMetal's are CrossOver's
 * builtins, whatever native copy a game or installer dropped.
 */
const BACKEND_OVERRIDES: Record<LibraryGraphicsBackend, string[]> = {
  dxmt: ['d3d11=native', 'dxgi=native', 'd3d10core=native'],
  d3dmetal: ['d3d11=builtin', 'd3d12=builtin', 'dxgi=builtin'],
  wined3d: [],
  'wined3d-gl': []
}

function baseEnv(bottle: string): NodeJS.ProcessEnv {
  let bottleEnvVars: Record<string, string> = {}
  try {
    bottleEnvVars = getBottleConfig(bottle).env_vars
  } catch {
    /* bottle without config: defaults */
  }
  return setupWineEnvVars({ ...process.env }, getActiveWineInstallation(), {
    winePrefix: getBottlePath(bottle),
    bottleEnvVars,
    gameLaunch: true
  })
}

/**
 * Launch environment for a library game: the same macOS stack as Blizzard
 * games (MoltenVK, gnutls, WRITECOPY, Rosetta AVX) without the Battle.net
 * client's overrides, which disable .NET, Gecko and Media Foundation
 * (needed by many games for video).
 */
export function buildLibraryGameEnv(
  bottle: string,
  backend: LibraryGraphicsBackend
): NodeJS.ProcessEnv {
  const env = baseEnv(bottle)
  applyMacGameStack(env, getActiveWineInstallation(), {
    dxmt: backend === 'dxmt',
    heapZero: false
  })
  const wined3d = backend === 'wined3d' || backend === 'wined3d-gl'
  applyGraphicsEnv(env, wined3d ? 'wined3d' : backend)
  if (backend === 'wined3d-gl') {
    // Per process, so the bottle's default (Vulkan) stays for other games.
    // wined3d's OpenGL renderer is its most complete one: e.g. Diablo II
    // aborts on the Vulkan one (vkCreateImageView) and runs on OpenGL.
    env.WINE_D3D_CONFIG = 'renderer=gl'
  }
  if (wined3d) {
    // Plain Wine D3D: do not route through CrossOver's D3DMetal backend.
    delete env.CX_ACTIVE_GRAPHICS_BACKEND
    delete env.CX_APPLEGPTK_LIBD3DSHARED_PATH
  }
  env.WINEDLLOVERRIDES = mergeDllOverrides(env.WINEDLLOVERRIDES, BACKEND_OVERRIDES[backend])
  // applyMacGameStack silences everything; keep errors for the game log.
  env.WINEDEBUG = 'fixme-all,err+module'
  return env
}

/**
 * `WINE_D3D_CONFIG=renderer=gl` (set by buildLibraryGameEnv for the process
 * Kalimotxo directly launches) only reaches that one process: a launcher
 * that spawns the actual game as a child (e.g. Project Diablo 2's
 * PD2Launcher.exe -> Game.exe) does not pass it on, and wined3d falls back
 * to Vulkan/MoltenVK there — the exact crash (GL_INVALID_FRAMEBUFFER_OPERATION)
 * the `wined3d-gl` backend exists to avoid. The registry equivalent
 * (`HKCU\Software\Wine\AppDefaults\<exe>\Direct3D`, `renderer=gl`) is
 * per-exe and Wine reads it fresh for every process, launcher or not.
 * Applied to every `.exe` next to the game's own, since which one ends up
 * doing the 3D rendering is not always obvious from the outside.
 */
export function applyWined3dGlAppDefaults(
  bottle: string,
  exe: string,
  log?: (m: string) => void
): boolean {
  const dir = dirname(exe)
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.exe'))
  } catch {
    return false
  }
  if (!names.length) return false

  const lines: string[] = []
  for (const name of names) {
    lines.push(`[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\${name}\\Direct3D]`, '"renderer"="gl"', '')
  }
  if (!importReg(bottle, lines, 'kalimotxo-wined3d-gl.reg', log)) return false
  log?.(`OpenGL renderer forced for: ${names.join(', ')}`)
  return true
}

/** Diablo II engine executables (1.13-era split DLLs: Fog, Storm, D2*.dll). */
const LEGACY_D2_EXES = ['Game.exe', 'Diablo II.exe']

/**
 * Diablo II's 1.13-era engine (used by mods such as Project Diablo 2) runs
 * a sanity check on every Windows critical section it creates: its
 * DebugInfo must be a real pointer below 2 GB. Since Windows 8, Wine (like
 * Windows for InitializeCriticalSectionEx) leaves DebugInfo as
 * 0xFFFFFFFF, so Fog.dll takes its fatal-error path before its own log is
 * up, and that path calls itself until the stack overflows ("Unhandled
 * stack overflow" in Fog.dll right at startup, identical on CrossOver).
 * Wine still allocates real DebugInfo when the reported version is older
 * than Windows 8, so these executables alone are presented as Windows XP
 * (per-exe AppDefaults) — the game's launcher and everything else in the
 * bottle keep the bottle's version (PD2Launcher needs Windows 7+).
 */
export function applyLegacyEngineAppDefaults(
  bottle: string,
  exe: string,
  log?: (m: string) => void
): boolean {
  const dir = dirname(exe)
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return false
  }
  const lower = new Set(files.map((f) => f.toLowerCase()))
  if (!lower.has('fog.dll')) return false
  const exes = LEGACY_D2_EXES.filter((e) => lower.has(e.toLowerCase()))
  if (!exes.length) return false

  const lines: string[] = []
  for (const name of exes) {
    lines.push(`[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\${name}]`, '"Version"="winxp"', '')
  }
  if (!importReg(bottle, lines, 'kalimotxo-legacy-engine.reg', log)) return false
  log?.(`Diablo II engine: Windows XP version for ${exes.join(', ')}`)
  return true
}

const CNC_DDRAW_MARKER = '.kalimotxo-cnc-ddraw'

/** Whether the game's own ddraw.dll is cnc-ddraw (a DirectDraw wrapper many classics ship). */
function isCncDdraw(file: string): boolean {
  try {
    return readFileSync(file).includes('cnc-ddraw')
  } catch {
    return false
  }
}

/** Replaces renderer=opengl with direct3d9 in a cnc-ddraw ini; returns whether it changed. */
function cncDdrawIniToD3d9(ini: string): boolean {
  try {
    const text = readFileSync(ini, 'utf-8')
    const next = text.replace(/^(\s*renderer\s*=\s*)opengl\s*$/im, '$1direct3d9')
    if (next === text) return false
    writeFileSync(ini, next)
    return true
  } catch {
    return false
  }
}

/** Project Diablo 2's launcher rewrites ddraw.ini from its own settings on every Play. */
function pd2LauncherSettingsToD3d9(json: string): boolean {
  try {
    const cfg = JSON.parse(readFileSync(json, 'utf-8')) as { DdrawOptions?: { Renderer?: string } }
    if (cfg.DdrawOptions?.Renderer?.toLowerCase() !== 'opengl') return false
    cfg.DdrawOptions.Renderer = 'direct3d9'
    writeFileSync(json, JSON.stringify(cfg, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * Games that ship cnc-ddraw as their own ddraw.dll (Project Diablo 2 among
 * many classics) need it to actually load: Wine's builtin ddraw otherwise
 * wins for exes a launcher spawns, and full-screen DirectDraw on macOS then
 * shows a black or windowed game with the mouse escaping it.
 * - Per-exe AppDefaults DllOverrides ddraw=native,builtin for every .exe in
 *   the folder (launchers do not use ddraw, so it is harmless for them).
 * - cnc-ddraw's OpenGL renderer does not get a usable context on macOS and
 *   falls back to slow software rendering ("-WARNING- Using slow software
 *   rendering ... (2.1)"); its Direct3D 9 renderer goes through wined3d and
 *   is hardware accelerated. Switched once (marker file), so a later choice
 *   the user makes in the game's own settings is kept.
 */
export function applyCncDdrawDefaults(
  bottle: string,
  exe: string,
  log?: (m: string) => void
): boolean {
  const dir = dirname(exe)
  if (!isCncDdraw(join(dir, 'ddraw.dll'))) return false

  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.exe'))
  } catch {
    return false
  }
  const lines: string[] = []
  for (const name of names) {
    lines.push(`[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\${name}\\DllOverrides]`, '"ddraw"="native,builtin"', '')
  }
  if (lines.length && importReg(bottle, lines, 'kalimotxo-cnc-ddraw.reg', log)) {
    log?.(`cnc-ddraw: native ddraw for ${names.join(', ')}`)
  }

  const marker = join(dir, CNC_DDRAW_MARKER)
  if (!existsSync(marker)) {
    const ini = cncDdrawIniToD3d9(join(dir, 'ddraw.ini'))
    const pd2 = pd2LauncherSettingsToD3d9(join(dir, 'AppData', 'launcherSettings.json'))
    if (ini || pd2) log?.('cnc-ddraw: renderer switched from OpenGL to Direct3D 9')
    writeFileSync(marker, 'cnc-ddraw renderer defaults applied by Kalimotxo\n')
  }
  return true
}

/** Imports REGEDIT4 `lines` into the bottle with one silent regedit. */
function importReg(
  bottle: string,
  lines: string[],
  fileName: string,
  log?: (m: string) => void
): boolean {
  const regFile = join(getBottlePath(bottle), 'drive_c', fileName)
  writeFileSync(regFile, ['REGEDIT4', '', ...lines].join('\r\n'))
  try {
    const r = spawnSync(getWineBinary(bottle), ['regedit', '/S', `C:\\${fileName}`], {
      env: buildEnv(bottle),
      timeout: 30_000
    })
    if (r.status !== 0) {
      log?.(`${fileName}: regedit failed (${r.status ?? r.signal})`)
      return false
    }
    return true
  } finally {
    rmSync(regFile, { force: true })
  }
}

/** Installers only need a working prefix: no graphics layer overrides. */
export function buildInstallerEnv(bottle: string): NodeJS.ProcessEnv {
  const env = baseEnv(bottle)
  applyMacGameStack(env, getActiveWineInstallation(), { dxmt: false, heapZero: false })
  delete env.WINE_DISABLE_VA_ALLOC
  return env
}
