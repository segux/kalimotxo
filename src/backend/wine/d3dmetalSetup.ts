import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import { execSync, spawn } from 'child_process'

import { getBundledD3dmetalDir, isBundledD3dmetalPresent } from '../config/bundled'
import { CACHE_DIR, D3DMETAL_DIR, WINE_DIR } from '../config/paths'
import { logInfo } from '../logger'

/**
 * DX12 DLL pair GPTK ships in its own bundled Wine, next to `lib/external`
 * (real Apple D3DMetal code, "Wine builtin DLL" marked). Used by
 * `d3dmetalDx12.ts` to run individual DX12-only games (e.g. Diablo II:
 * Resurrected) through real D3DMetal without touching Wine's own
 * `d3d12.dll`/`dxgi.dll` builtins, which stay on vkd3d/MoltenVK for everyone
 * else. See that file for why: two Wines can compile different `d3d12.dll`
 * builtins from the same open CX sources, and only GPTK's own precompiled
 * ones carry Apple's real D3DMetal code.
 */
const DX12_DLLS = ['d3d12', 'dxgi'] as const

const GPTK_APP_EXTERNAL =
  '/Applications/Game Porting Toolkit.app/Contents/Resources/wine/lib/external'
const GCENX_WINE_TAP = 'gcenx/wine'
const GPTK_CASK = 'gcenx/wine/game-porting-toolkit'

const GPTK_DMG_GLOBS = [
  '*Game*Porting*Toolkit*.dmg',
  '*game*porting*toolkit*.dmg',
  '*Evaluation*environment*.dmg',
  '*evaluation*environment*.dmg',
  '*GPTK*.dmg'
]

function copyTree(src: string, dest: string): void {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
}

export function isD3dmetalRuntimeReady(): boolean {
  return (
    existsSync(join(D3DMETAL_DIR, 'D3DMetal.framework')) ||
    existsSync(join(D3DMETAL_DIR, 'libd3dshared.dylib'))
  )
}

/** Whether the DX12 DLL pair (see `d3dmetalDx12.ts`) is already imported. */
export function isD3dmetalDx12Ready(): boolean {
  const dir = join(D3DMETAL_DIR, 'dx12')
  return DX12_DLLS.every(
    (dll) =>
      existsSync(join(dir, 'x86_64-windows', `${dll}.dll`)) &&
      existsSync(join(dir, 'x86_64-unix', `${dll}.so`))
  )
}

/** Copia D3DMetal.framework + libd3dshared desde lib/external de Game Porting Toolkit. */
export function installD3dmetalFromExternalDir(externalDir: string): [boolean, string] {
  if (!existsSync(externalDir)) {
    return [false, `No existe: ${externalDir}`]
  }

  mkdirSync(D3DMETAL_DIR, { recursive: true })
  const copied: string[] = []
  const fwSrc = join(externalDir, 'D3DMetal.framework')
  const dylibSrc = join(externalDir, 'libd3dshared.dylib')

  if (existsSync(fwSrc)) {
    copyTree(fwSrc, join(D3DMETAL_DIR, 'D3DMetal.framework'))
    copied.push('D3DMetal.framework')
  }
  if (existsSync(dylibSrc)) {
    copyFileSync(dylibSrc, join(D3DMETAL_DIR, 'libd3dshared.dylib'))
    copied.push('libd3dshared.dylib')
  }

  // `lib/external` and `lib/wine` are siblings under GPTK's own Wine root.
  const wineDir = join(externalDir, '..', 'wine')
  const dx12Dir = join(D3DMETAL_DIR, 'dx12')
  for (const dll of DX12_DLLS) {
    const pe = join(wineDir, 'x86_64-windows', `${dll}.dll`)
    const unix = join(wineDir, 'x86_64-unix', `${dll}.so`)
    if (!existsSync(pe) || !existsSync(unix)) continue
    mkdirSync(join(dx12Dir, 'x86_64-windows'), { recursive: true })
    mkdirSync(join(dx12Dir, 'x86_64-unix'), { recursive: true })
    copyFileSync(pe, join(dx12Dir, 'x86_64-windows', `${dll}.dll`))
    copyFileSync(unix, join(dx12Dir, 'x86_64-unix', `${dll}.so`))
    copied.push(`dx12/${dll}`)
  }

  if (!copied.length) {
    return [false, 'No hay D3DMetal.framework ni libd3dshared.dylib en esa carpeta']
  }
  return [true, `D3DMetal instalado: ${copied.join(', ')}`]
}

/** Copia desde `resources/bundled/d3dmetal` (build privado / maintainer). */
export function installD3dmetalFromAppBundle(): [boolean, string] {
  if (!isBundledD3dmetalPresent()) {
    return [false, 'Kalimotxo no incluye D3DMetal embebido en esta build']
  }
  return installD3dmetalFromExternalDir(getBundledD3dmetalDir())
}

function findLibExternal(root: string): string | null {
  const candidates = [
    join(root, 'lib', 'external'),
    join(root, 'lib64', 'apple_gptk', 'external'),
    join(root, 'share', 'wine', 'lib', 'external')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'D3DMetal.framework')) || existsSync(join(dir, 'libd3dshared.dylib'))) {
      return dir
    }
  }
  try {
    for (const name of readdirSync(root)) {
      const p = join(root, name, 'lib', 'external')
      if (existsSync(join(p, 'D3DMetal.framework'))) return p
      const gptk = join(root, name, 'lib64', 'apple_gptk', 'external')
      if (existsSync(join(gptk, 'D3DMetal.framework'))) return gptk
    }
  } catch {
    /* ignore */
  }
  return findExternalInTree(root)
}

function findExternalInTree(root: string): string | null {
  const queue = [root]
  const seen = new Set<string>()
  while (queue.length) {
    const dir = queue.shift()!
    if (seen.has(dir)) continue
    seen.add(dir)
    if (existsSync(join(dir, 'D3DMetal.framework'))) return dir
    if (basename(dir) === 'external' && existsSync(join(dir, 'D3DMetal.framework'))) {
      return dir
    }
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name === '.' || name === '..') continue
      const p = join(dir, name)
      try {
        if (statSync(p).isDirectory()) queue.push(p)
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export function installD3dmetalFromGptkApp(): [boolean, string] {
  if (existsSync(GPTK_APP_EXTERNAL)) {
    return installD3dmetalFromExternalDir(GPTK_APP_EXTERNAL)
  }
  // Kalimotxo's own Wine manager can also hold a full GPTK copy (imported the
  // same way as any other Wine, under `runtime/wine/<Type>-latest`) instead
  // of the app living in /Applications.
  const managed = findGptkAppUnderWineDir()
  if (managed) return installD3dmetalFromExternalDir(managed)
  return [false, 'Game Porting Toolkit.app no instalado']
}

/** Looks for `Game Porting Toolkit.app` one level under `runtime/wine`. */
function findGptkAppUnderWineDir(): string | null {
  let entries: string[]
  try {
    entries = readdirSync(WINE_DIR)
  } catch {
    return null
  }
  for (const name of entries) {
    const external = join(
      WINE_DIR,
      name,
      'Game Porting Toolkit.app',
      'Contents',
      'Resources',
      'wine',
      'lib',
      'external'
    )
    if (existsSync(external)) return external
  }
  return null
}

function globDmgsInDir(dir: string, pattern: string): string[] {
  if (!existsSync(dir)) return []
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i'
  )
  try {
    return readdirSync(dir)
      .filter((n) => rx.test(n) && n.toLowerCase().endsWith('.dmg'))
      .map((n) => join(dir, n))
  } catch {
    return []
  }
}

function findGptkDmgFiles(): string[] {
  const roots = [
    join(homedir(), 'Downloads'),
    join(homedir(), 'Developer'),
    CACHE_DIR
  ]
  const found = new Set<string>()
  for (const root of roots) {
    for (const pattern of GPTK_DMG_GLOBS) {
      for (const p of globDmgsInDir(root, pattern)) found.add(p)
    }
  }
  return [...found]
}

function attachDmg(dmgPath: string): string | null {
  try {
    const out = execSync(`hdiutil attach "${dmgPath}" -nobrowse -readonly`, {
      encoding: 'utf-8',
      timeout: 120_000
    })
    for (const line of out.trim().split('\n')) {
      const parts = line.split('\t')
      if (parts.length >= 3) {
        const mount = parts[parts.length - 1]?.trim()
        if (mount && existsSync(mount)) return mount
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function detachDmg(mount: string): void {
  try {
    execSync(`hdiutil detach "${mount}" -quiet`, { timeout: 60_000 })
  } catch {
    /* ignore */
  }
}

function extractD3dmetalFromMountedDmg(mountPoint: string): [boolean, string] {
  const ext = findExternalInTree(mountPoint)
  if (ext) return installD3dmetalFromExternalDir(ext)

  try {
    for (const name of readdirSync(mountPoint)) {
      if (!name.toLowerCase().endsWith('.dmg')) continue
      const inner = join(mountPoint, name)
      const innerMount = attachDmg(inner)
      if (!innerMount) continue
      try {
        const innerExt = findExternalInTree(innerMount)
        if (innerExt) return installD3dmetalFromExternalDir(innerExt)
      } finally {
        detachDmg(innerMount)
      }
    }
  } catch {
    /* ignore */
  }
  return [false, 'lib/external no encontrado en el DMG']
}

export function installD3dmetalFromGptkDmg(dmgPath: string): [boolean, string] {
  if (!existsSync(dmgPath)) return [false, `DMG no encontrado: ${dmgPath}`]
  const mount = attachDmg(dmgPath)
  if (!mount) return [false, `No se pudo montar ${basename(dmgPath)}`]
  try {
    return extractD3dmetalFromMountedDmg(mount)
  } finally {
    detachDmg(mount)
  }
}

function getBrewPath(): string | null {
  const paths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  try {
    return execSync('which brew', { encoding: 'utf-8', timeout: 5000 }).trim() || null
  } catch {
    return null
  }
}

function runBrew(
  args: string[],
  onLog?: (line: string) => void
): Promise<[boolean, string]> {
  const brew = getBrewPath()
  if (!brew) return Promise.resolve([false, 'Homebrew is not installed'])

  const lines: string[] = []
  const proc = spawn(brew, args, {
    env: {
      ...process.env,
      HOMEBREW_NO_AUTO_UPDATE: '1',
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
    }
  })
  proc.stdout?.on('data', (d) => {
    const s = d.toString()
    lines.push(s)
    onLog?.(s.trim())
  })
  proc.stderr?.on('data', (d) => {
    const s = d.toString()
    lines.push(s)
    onLog?.(s.trim())
  })

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      const out = lines.join('\n').slice(-4000)
      resolve([code === 0, out || (code === 0 ? 'OK' : `brew exit ${code}`)])
    })
    proc.on('error', (e) => resolve([false, e.message]))
  })
}

/** Gcenx cask (GPTK 3) — Homebrew installs it on your Mac legally; we do not redistribute it. */
export async function installD3dmetalViaHomebrewCask(
  onLog?: (line: string) => void
): Promise<[boolean, string]> {
  const log = onLog ?? (() => {})
  const fromApp = installD3dmetalFromGptkApp()
  if (fromApp[0]) return fromApp

  if (!getBrewPath()) {
    return [false, 'Homebrew is required to install Game Porting Toolkit automatically']
  }

  log('Installing Game Porting Toolkit (Gcenx) via Homebrew...')
  const [tapOk, tapMsg] = await runBrew(['tap', GCENX_WINE_TAP], log)
  if (!tapOk) return [false, `brew tap: ${tapMsg.slice(0, 400)}`]

  const [installOk, installMsg] = await runBrew(
    ['install', '--cask', '--no-quarantine', GPTK_CASK],
    log
  )
  if (!installOk) {
    return [false, `Fallo al instalar GPTK: ${installMsg.slice(0, 500)}`]
  }
  return installD3dmetalFromGptkApp()
}

export type EnsureD3dmetalOptions = {
  onLog?: (line: string) => void
  /** Si true, intenta `brew install --cask game-porting-toolkit` al final. */
  allowHomebrew?: boolean
}

/**
 * Instala D3DMetal en ~/.kalimotxo/runtime/d3dmetal sin pasos manuales cuando es posible.
 * Orden: ya instalado → bundle de la app → GPTK.app → DMGs en Downloads → Homebrew.
 */
export async function ensureD3dmetal(
  options: EnsureD3dmetalOptions = {}
): Promise<[boolean, string]> {
  const { onLog, allowHomebrew = true } = options
  const log = onLog ?? (() => {})

  if (isD3dmetalRuntimeReady()) {
    return [true, 'D3DMetal listo']
  }

  log('Buscando D3DMetal…')

  const bundled = installD3dmetalFromAppBundle()
  if (bundled[0]) {
    logInfo(bundled[1])
    return bundled
  }

  const fromApp = installD3dmetalFromGptkApp()
  if (fromApp[0]) {
    logInfo(fromApp[1])
    return fromApp
  }

  for (const dmg of findGptkDmgFiles()) {
    log(`Probando DMG: ${basename(dmg)}`)
    const fromDmg = installD3dmetalFromGptkDmg(dmg)
    if (fromDmg[0]) {
      logInfo(fromDmg[1])
      return fromDmg
    }
  }

  if (allowHomebrew) {
    return installD3dmetalViaHomebrewCask(log)
  }

  return [
    false,
    'D3DMetal not available. Put Apple\'s Game Porting Toolkit DMG in Downloads or let Kalimotxo install it with Homebrew.'
  ]
}

/**
 * Synchronous: fast local sources only (no Homebrew). Also tops up the DX12
 * DLL pair (`dx12/`) for installs done before it was imported, since
 * `isD3dmetalRuntimeReady` alone would otherwise short-circuit and skip it.
 */
export function ensureD3dmetalForDx12Games(): [boolean, string] {
  if (isD3dmetalRuntimeReady() && isD3dmetalDx12Ready()) return [true, 'D3DMetal listo']

  for (const fn of [
    installD3dmetalFromAppBundle,
    installD3dmetalFromGptkApp
  ]) {
    const r = fn()
    if (r[0] && isD3dmetalDx12Ready()) return r
  }

  for (const dmg of findGptkDmgFiles()) {
    const r = installD3dmetalFromGptkDmg(dmg)
    if (r[0] && isD3dmetalDx12Ready()) return r
  }

  if (isD3dmetalRuntimeReady()) {
    return [
      true,
      'D3DMetal listo (sin DLLs DX12 individuales: algunos juegos seguirán en Wine builtin)'
    ]
  }
  return [
    false,
    'D3DMetal (GPTK) is missing. Kalimotxo installs it in the setup wizard from Apple\'s Game Porting Toolkit (via Homebrew if needed).'
  ]
}
