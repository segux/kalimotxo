import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { D3DMETAL_DIR, DXMT_DIR, DXVK_DIR, WINE_DIR } from '../config/paths'
import { migrateLegacyInstall, resolveActiveWineRoot } from '../wine/manager/installed'

/** Locates wine64 or wine under a directory tree (.app bundle or flat layout). */
export function findWine64InTree(root: string): string | null {
  if (!existsSync(root)) return null

  for (const rel of ['bin/wine64', 'bin/wine']) {
    const candidate = join(root, rel)
    if (existsSync(candidate)) return candidate
  }

  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }

  for (const name of entries) {
    if (!name.endsWith('.app')) continue
    const binDir = join(root, name, 'Contents/Resources/wine/bin')
    for (const bin of ['wine64', 'wine']) {
      const candidate = join(binDir, bin)
      if (existsSync(candidate)) return candidate
    }
  }

  for (const name of entries) {
    if (name === '.DS_Store') continue
    const child = join(root, name)
    try {
      if (statSync(child).isDirectory()) {
        const found = findWine64InTree(child)
        if (found) return found
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

/** Checks for Windows DLL folders (flat layout or one level nested, e.g. dxmt/v0.74/). */
export function componentHasDllFolders(
  base: string,
  x64Folder: string,
  x32Folder: string
): boolean {
  if (!existsSync(base)) return false

  const roots = [base]
  try {
    for (const name of readdirSync(base)) {
      const p = join(base, name)
      if (statSync(p).isDirectory()) roots.push(p)
    }
  } catch {
    return false
  }

  for (const root of roots) {
    if (existsSync(join(root, x64Folder)) || existsSync(join(root, x32Folder))) return true
    if (existsSync(join(root, 'x64')) || existsSync(join(root, 'x32'))) return true
  }
  return false
}

export function isDxmtInstalled(): boolean {
  return (
    existsSync(join(DXMT_DIR, 'dxmt.dll')) ||
    componentHasDllFolders(DXMT_DIR, 'x86_64-windows', 'i386-windows')
  )
}

export function isDxvkInstalled(): boolean {
  return (
    existsSync(join(DXVK_DIR, 'x64', 'dxgi.dll')) ||
    componentHasDllFolders(DXVK_DIR, 'x64', 'x32')
  )
}

export function isD3dmetalInstalled(): boolean {
  return (
    existsSync(join(D3DMETAL_DIR, 'D3DMetal.framework')) ||
    existsSync(join(D3DMETAL_DIR, 'd3dmetal.dylib'))
  )
}

export function findWine64(): string | null {
  migrateLegacyInstall()
  const activeRoot = resolveActiveWineRoot()
  if (activeRoot) {
    const inActive = findWine64InTree(activeRoot)
    if (inActive) return inActive
  }
  const inTree = findWine64InTree(WINE_DIR)
  if (inTree) return inTree
  const flat = join(WINE_DIR, 'wine64')
  if (existsSync(flat)) return flat
  return null
}

export function isWineInstalled(): boolean {
  return findWine64() !== null
}
