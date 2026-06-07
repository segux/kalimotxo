import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'

import { DXMT_DIR, D3DMETAL_DIR } from '../config/paths'
import { resolveBundledGnutlsDir, resolveWineExternalDir } from './wineEnv'
import { resolveBattleNetWineInstallation } from './compatibilityLayers'
import type { WineInstallation } from './types'

/**
 * macOS strips `DYLD_*` variables (including `DYLD_FALLBACK_LIBRARY_PATH`) when
 * Wine spawns CHILD processes: the preloader is re-exec'd from `$TMPDIR` without
 * the entitlement that the launching `wine` binary has. As a result, in the
 * Battle.net client process tree neither `libMoltenVK.dylib` (GPU) nor
 * `libgnutls` (schannel/curl TLS) load, even though wineEnv.ts points at them.
 *
 * `winevulkan.so` and `secur32.so` carry the rpath `@loader_path/` (i.e. their
 * own `lib/wine/x86_64-unix/` directory). Copying the dylibs there makes them
 * load via `@loader_path` WITHOUT depending on `DYLD_FALLBACK`, so the whole tree
 * (client + Agent + CEF renderers) finds them. Without this: black window (ANGLE
 * falls back to SwiftShader) and `CURL error 35` / `SEC_E_SECPKG_NOT_FOUND` (no
 * TLS), which makes the Agent mark the build "non-playable" and never serve the
 * client.
 *
 * See docs/battlenet-wine-problemas-y-roadmap.md (2026-06-04 session, DYLD root
 * cause).
 */

/** `<root>/lib/wine/x86_64-unix` of the active Wine (next to winevulkan.so/secur32.so). */
function wineUnixLibDir(installation: WineInstallation): string | null {
  const binDir = dirname(installation.bin) // <root>/bin
  const root = dirname(binDir) // <root>
  const unix = join(root, 'lib', 'wine', 'x86_64-unix')
  return existsSync(unix) ? unix : null
}

/** `libMoltenVK.dylib` bundled next to Wine (lib/external) or under runtime/dxmt. */
function resolveMoltenVkSource(installation: WineInstallation): string | null {
  const ext = resolveWineExternalDir(installation)
  if (ext) {
    const lib = join(ext, 'libMoltenVK.dylib')
    if (existsSync(lib)) return lib
  }
  if (existsSync(DXMT_DIR)) {
    const stack = [DXMT_DIR]
    while (stack.length) {
      const dir = stack.pop() as string
      const lib = join(dir, 'libMoltenVK.dylib')
      if (existsSync(lib)) return lib
      try {
        for (const name of readdirSync(dir)) {
          const child = join(dir, name)
          if (statSync(child).isDirectory()) stack.push(child)
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

/** `libd3dshared.dylib` from D3DMetal (GPTK) if present in the runtime. */
function resolveD3dSharedSource(installation: WineInstallation): string | null {
  const ext = resolveWineExternalDir(installation)
  if (ext) {
    const lib = join(ext, 'libd3dshared.dylib')
    if (existsSync(lib)) return lib
  }
  // Also check next to D3DMetal.framework in the runtime
  const d3dmetalShared = join(D3DMETAL_DIR, 'libd3dshared.dylib')
  if (existsSync(d3dmetalShared)) return d3dmetalShared
  return null
}

function copyIfDifferent(src: string, dest: string): boolean {
  try {
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) return false
    copyFileSync(src, dest)
    return true
  } catch {
    return false
  }
}

/**
 * Ensures `libMoltenVK.dylib` and the `libgnutls` bundle (plus all its deps) live
 * in the active Wine's `lib/wine/x86_64-unix/`, so they load via `@loader_path`
 * without `DYLD_FALLBACK` (which macOS strips from child processes). Idempotent.
 *
 * @returns the list of changes made (empty if everything was already in place).
 */
export function ensureBattleNetWineRuntimeLibs(
  installation: WineInstallation = resolveBattleNetWineInstallation(),
  log?: (line: string) => void
): string[] {
  const changes: string[] = []
  const unix = wineUnixLibDir(installation)
  if (!unix) return changes
  mkdirSync(unix, { recursive: true })

  // MoltenVK (GPU): without it ANGLE-Vulkan can't find MoltenVK -> black window.
  const moltenSrc = resolveMoltenVkSource(installation)
  if (moltenSrc && copyIfDifferent(moltenSrc, join(unix, 'libMoltenVK.dylib'))) {
    changes.push('libMoltenVK.dylib')
  }

  // libd3dshared.dylib (D3DMetal): without it D3DMetal can't initialize.
  // CrossOver 26.1 sets CX_APPLEGPTK_LIBD3DSHARED_PATH but macOS strips DYLD_*
  // in child processes, so we copy it to where wine's D3DMetal loader expects it.
  const d3dSharedSrc = resolveD3dSharedSource(installation)
  if (d3dSharedSrc && copyIfDifferent(d3dSharedSrc, join(unix, 'libd3dshared.dylib'))) {
    changes.push('libd3dshared.dylib')
  }

  // gnutls + deps (TLS): the bundle is self-contained (@loader_path between the
  // dylibs), so we copy the entire .dylib set to avoid breaking transitive deps
  // (libffi, libiconv, libintl, nettle, hogweed, p11-kit, ...).
  if (!existsSync(join(unix, 'libgnutls.30.dylib'))) {
    const gnutlsDir = resolveBundledGnutlsDir()
    if (gnutlsDir) {
      let copied = 0
      try {
        for (const name of readdirSync(gnutlsDir)) {
          if (!name.endsWith('.dylib')) continue
          // Wine's own libraries are .so (no name clash with .dylib), but never
          // overwrite a .dylib that the Wine build already ships.
          const dest = join(unix, name)
          if (existsSync(dest)) continue
          try {
            copyFileSync(join(gnutlsDir, name), dest)
            copied++
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      if (copied) changes.push(`gnutls bundle (${copied} dylibs)`)
    }
  }

  if (changes.length) {
    log?.(`Wine runtime: copied libs into x86_64-unix -> ${changes.join(', ')}`)
  }
  return changes
}
