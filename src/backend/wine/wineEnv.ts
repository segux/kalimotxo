import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { DATA_DIR, DXMT_DIR, D3DMETAL_DIR, WINE_DIR } from '../config/paths'
import { ensureOAuthBrowserScript } from '../storeManagers/battlenet/oauthBrowserScript'
import type { WineInstallation } from './types'

const GRAPHICS_STRIP = [
  'DXMT_ASYNC',
  'DXMT_LOG_LEVEL',
  'MTL_HUD_ENABLED',
  'D3DMETAL',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_LIBRARY_PATH',
  'DXVK_HUD',
  'DXVK_ASYNC',
  'WINEESYNC',
  'WINEMSYNC',
  'WINE_DISABLE_VA_ALLOC'
] as const

const WINEMENU_DISABLE = 'winemenubuilder.exe=d'

/**
 * Wine Staging (Gcenx) does NOT implement the CodeWeavers `WINE_SIMULATE_WRITECOPY`
 * patch and deadlocks in `loader_section` when it is set (infinite "updating Wine"
 * window). CrossOver / D4Mac builds (wine-cx*, Wine 11) do support it and need it
 * so CEF does not crash with `nested exception on signal stack`.
 */
function wineSupportsWriteCopy(installation: WineInstallation): boolean {
  return !/staging/i.test(installation.name)
}

/** DXMT subdirs with builtin DLLs (`i386-windows`, `x86_64-windows`), searching one level deep (e.g. `dxmt/v0.74/`). */
function resolveDxmtBuiltinDirs(): string[] {
  if (!existsSync(DXMT_DIR)) return []
  const wanted = ['i386-windows', 'x86_64-windows']
  const roots = [DXMT_DIR]
  try {
    for (const name of readdirSync(DXMT_DIR)) {
      const p = join(DXMT_DIR, name)
      if (statSync(p).isDirectory()) roots.push(p)
    }
  } catch {
    return []
  }
  const dirs: string[] = []
  for (const root of roots) {
    for (const sub of wanted) {
      const candidate = join(root, sub)
      if (existsSync(candidate)) dirs.push(candidate)
    }
  }
  return dirs
}

/** DXMT `x86_64-unix` directory (contains `winemetal.so`) for `DYLD_FALLBACK_LIBRARY_PATH`. */
function resolveDxmtUnixDir(): string | null {
  if (!existsSync(DXMT_DIR)) return null
  const roots = [DXMT_DIR]
  try {
    for (const name of readdirSync(DXMT_DIR)) {
      const p = join(DXMT_DIR, name)
      if (statSync(p).isDirectory()) roots.push(p)
    }
  } catch {
    return null
  }
  for (const root of roots) {
    const unix = join(root, 'x86_64-unix')
    if (existsSync(unix)) return unix
  }
  return null
}

/** `libd3dshared.dylib` from D3DMetal (GPTK) if present in the runtime. */
function resolveD3dmetalSharedLib(): string | null {
  const lib = join(D3DMETAL_DIR, 'libd3dshared.dylib')
  return existsSync(lib) ? lib : null
}

/**
 * Directory that contains a `libgnutls.30.dylib` **x86_64** (plus its deps via
 * `@loader_path`) for `DYLD_FALLBACK_LIBRARY_PATH`. Battle.net's Wine runs under
 * Rosetta (x86_64) and its `secur32`/`bcrypt` load gnutls for TLS; without it the
 * Agent cannot do HTTPS (`CURL error 35`) and the client hangs.
 * The Wine-Crossover / GPTK / Staging builds that Kalimotxo downloads already
 * bundle these dylibs in `…/Resources/wine/lib`.
 */
export function resolveBundledGnutlsDir(): string | null {
  if (!existsSync(WINE_DIR)) return null
  const stack: string[] = [WINE_DIR]
  let guard = 0
  while (stack.length && guard++ < 5000) {
    const dir = stack.pop() as string
    if (existsSync(join(dir, 'libgnutls.30.dylib'))) return dir
    try {
      for (const name of readdirSync(dir)) {
        if (name === '.DS_Store') continue
        const child = join(dir, name)
        try {
          if (statSync(child).isDirectory()) stack.push(child)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * `lib/external` directory that some "Battle.net ready" Wine builds
 * (D4Mac / Wine 11 + GPTK) ship next to the binary, with DXMT, D3DMetal,
 * `libd3dshared.dylib` and `libMoltenVK.dylib` **matched** to that Wine version.
 * Preferred over the loose `runtime/` components when present.
 * `installation.bin` is `<root>/bin/wine`.
 */
export function resolveWineExternalDir(installation: WineInstallation): string | null {
  const binDir = installation.bin.replace(/\/[^/]+$/, '') // <root>/bin
  const root = binDir.replace(/\/[^/]+$/, '') // <root>
  const ext = join(root, 'lib', 'external')
  return existsSync(ext) ? ext : null
}

function prependPath(existing: string | undefined, parts: string[]): string {
  const all = [...parts, ...(existing ? existing.split(':') : [])].filter(Boolean)
  return [...new Set(all)].join(':')
}

/** Last occurrence wins (avoids locationapi=n,b and locationapi=d at the same time). */
export function mergeDllOverrides(existing: string | undefined, extra: string[]): string {
  const map = new Map<string, string>()
  const ingest = (chunk: string): void => {
    const t = chunk.trim()
    if (!t) return
    const eq = t.indexOf('=')
    if (eq === -1) return
    const dll = t.slice(0, eq).trim()
    const mode = t.slice(eq + 1).trim()
    if (dll) map.set(dll.toLowerCase(), `${dll}=${mode}`)
  }
  for (const part of (existing ?? '').split(';')) ingest(part)
  for (const part of extra) ingest(part)
  return [...map.values()].join(';')
}

/**
 * Wine environment variables, Heroic-style `setupWineEnvVars` (macOS / Battle.net).
 */
export function setupWineEnvVars(
  base: NodeJS.ProcessEnv,
  installation: WineInstallation,
  options: {
    winePrefix?: string
    crossoverBottle?: string
    bottleEnvVars?: Record<string, string>
    battleNetLaunch?: boolean
    gameLaunch?: boolean
  }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }

  for (const key of GRAPHICS_STRIP) {
    delete env[key]
  }

  delete env.WINEESYNC
  delete env.WINEMSYNC

  if (options.bottleEnvVars) {
    for (const [k, v] of Object.entries(options.bottleEnvVars)) {
      if (
        options.battleNetLaunch &&
        GRAPHICS_STRIP.includes(k as (typeof GRAPHICS_STRIP)[number])
      ) {
        continue
      }
      env[k] = v
    }
  }

  switch (installation.type) {
    case 'crossover':
      if (options.crossoverBottle) {
        env.CX_BOTTLE = options.crossoverBottle
      }
      delete env.WINEPREFIX
      break
    case 'toolkit':
    case 'wine':
    default:
      if (options.winePrefix) {
        env.WINEPREFIX = options.winePrefix
      }
      env.WINEARCH = env.WINEARCH ?? 'win64'
      break
  }

  env.WINEDLLOVERRIDES = mergeDllOverrides(env.WINEDLLOVERRIDES, [WINEMENU_DISABLE])

  if (options.battleNetLaunch) {
    // "Battle.net ready" stack aligned with D4Mac (Wine 11 + GPTK 3 + DXMT).
    // Applied to BOTH the launcher client AND game launches — all Blizzard
    // titles need it (WRITECOPY for exception handling, MoltenVK for GPU,
    // gnutls for TLS, DXMT/D3DMetal for graphics).
    // See docs/battlenet-wine-problemas-y-roadmap.md §3e.
    env.WINE_LARGE_ADDRESS_AWARE = env.WINE_LARGE_ADDRESS_AWARE ?? '1'
    env.WINE_HEAP_ZERO_MEMORY = env.WINE_HEAP_ZERO_MEMORY ?? '1'
    if (process.arch === 'arm64') {
      env.ROSETTA_ADVERTISE_AVX = '1'
    }
    // CEF/exception patch (copy-on-write) — only on Wines that support it;
    // omitted on Staging where it causes a deadlock.
    if (wineSupportsWriteCopy(installation)) {
      env.WINE_SIMULATE_WRITECOPY = env.WINE_SIMULATE_WRITECOPY ?? '1'
    }
    env.WINEDEBUG = '-all'
    env.WINEDLLOVERRIDES = mergeDllOverrides(env.WINEDLLOVERRIDES, [
      'location=d',
      'locationapi=d',
      'mscoree=d',
      'mshtml=d',
      'vcruntime140_1=n,b',
      'msvcp140_1=n,b',
      'mf=n,b',
      // CRITICAL: force Wine's builtin `vulkan-1` (winevulkan -> MoltenVK,
      // which DOES expose VK_KHR_win32_surface). Otherwise ANGLE loads the
      // headless SwiftShader `vulkan-1.dll` that Battle.net ships in its folder
      // which has no surface WSI -> the CEF window never paints.
      'vulkan-1=b'
    ])

    // `lib/external` libs bundled with the active Wine (D4Mac / Wine 11),
    // matched to that version. Preferred over the loose `runtime/` components.
    const wineExt = resolveWineExternalDir(installation)

    // CRITICAL: DXMT as a Wine builtin DLL via WINEDLLPATH (not loose copies in
    // syswow64). Without this the CEF renderer dies with a fatal GPU error.
    const dxmtDirs: string[] = []
    if (wineExt) {
      for (const sub of ['i386-windows', 'x86_64-windows']) {
        const d = join(wineExt, 'dxmt', sub)
        if (existsSync(d)) dxmtDirs.push(d)
      }
    }
    dxmtDirs.push(...resolveDxmtBuiltinDirs())
    if (dxmtDirs.length) {
      env.WINEDLLPATH = prependPath(env.WINEDLLPATH, dxmtDirs)
    }

    // D3DMetal (GPTK 3) as graphics backend, CrossOver-style.
    const extSharedLib = wineExt ? join(wineExt, 'libd3dshared.dylib') : ''
    const sharedLib =
      extSharedLib && existsSync(extSharedLib) ? extSharedLib : resolveD3dmetalSharedLib()
    if (sharedLib) {
      env.CX_ACTIVE_GRAPHICS_BACKEND = 'd3dmetal'
      env.CX_APPLEGPTK_LIBD3DSHARED_PATH = sharedLib
    }

    // MoltenVK / D3DMetal / winemetal.so for the macOS dynamic loader.
    const fallbackLibDirs: string[] = []
    if (wineExt) {
      // libMoltenVK.dylib + libd3dshared.dylib live here.
      fallbackLibDirs.push(wineExt)
      const extD3dmetalFw = join(wineExt, 'D3DMetal.framework', 'Versions', 'A')
      if (existsSync(extD3dmetalFw)) fallbackLibDirs.push(extD3dmetalFw)
      const extDxmtUnix = join(wineExt, 'dxmt', 'x86_64-unix')
      if (existsSync(extDxmtUnix)) fallbackLibDirs.push(extDxmtUnix)
    }
    const d3dmetalFw = join(D3DMETAL_DIR, 'D3DMetal.framework', 'Versions', 'A')
    if (existsSync(d3dmetalFw)) fallbackLibDirs.push(d3dmetalFw)
    if (existsSync(D3DMETAL_DIR)) fallbackLibDirs.push(D3DMETAL_DIR)
    const dxmtUnix = resolveDxmtUnixDir()
    if (dxmtUnix) fallbackLibDirs.push(dxmtUnix)
    // libgnutls x86_64 so that schannel/bcrypt TLS works (Agent HTTPS).
    const gnutlsDir = resolveBundledGnutlsDir()
    if (gnutlsDir) fallbackLibDirs.push(gnutlsDir)
    if (fallbackLibDirs.length) {
      env.DYLD_FALLBACK_LIBRARY_PATH = prependPath(
        env.DYLD_FALLBACK_LIBRARY_PATH,
        fallbackLibDirs
      )
    }
  }

  if (options.gameLaunch && options.winePrefix) {
    env.WINE_DISABLE_VA_ALLOC = env.WINE_DISABLE_VA_ALLOC ?? '1'
    env.WINEDEBUG = 'err+module'
  }

  // CrossOver 26.1 sets this for .NET 7/8 apps under Rosetta (D2R uses .NET).
  if (process.arch === 'arm64') {
    env.DOTNET_EnableWriteXorExecute = '0'
  }

  if (installation.type === 'toolkit' && process.arch === 'arm64') {
    env.ROSETTA_ADVERTISE_AVX = '1'
  }

  if (process.platform === 'darwin' && options.battleNetLaunch) {
    try {
      env.BROWSER = ensureOAuthBrowserScript()
      env.KALIMOTXO_DATA = process.env.KALIMOTXO_DATA ?? DATA_DIR
    } catch {
      /* optional script — absent in dev without scripts/ */
    }
  }

  const binDir = installation.bin.includes('/')
    ? installation.bin.replace(/\/[^/]+$/, '')
    : ''
  if (binDir) {
    env.PATH = `${binDir}:${process.env.PATH || ''}`
  }

  env.WINE = installation.bin
  const ws =
    installation.wineserver ??
    installation.bin.replace(/wine64?$/, 'wineserver')
  if (ws && existsSync(ws)) {
    env.WINESERVER = ws
  }

  return env
}
