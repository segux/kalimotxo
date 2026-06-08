import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { RUNTIME_DIR, WINE_DIR } from '../../config/paths'
import {
  findRelease,
  getActiveVersionId,
  loadCatalog,
  saveCatalog,
  setActiveVersionId
} from './catalog'
import { REPO_BY_TYPE } from './repositories'
import type { WineRelease } from './types'

export function wineToolsRoot(): string {
  return join(RUNTIME_DIR, 'wine')
}

export function gptkToolsRoot(): string {
  return join(RUNTIME_DIR, 'game-porting-toolkit')
}

export function installRootForType(wineType: string): string {
  const repo = REPO_BY_TYPE[wineType]
  if (repo?.installCategory === 'game-porting-toolkit') return gptkToolsRoot()
  return wineToolsRoot()
}

export function installDirForVersion(version: string, wineType: string): string {
  const root = installRootForType(wineType)
  const safe = version.replace(/\//g, '_').replace(/ /g, '_')
  return join(root, safe)
}

export function findWine64InTree(root: string): string | null {
  if (!existsSync(root)) return null
  for (const rel of ['bin/wine64', 'bin/wine']) {
    const candidate = join(root, rel)
    if (existsSync(candidate)) return candidate
  }
  try {
    const entries = readdirSync(root)
    // First pass: flat (non-.app) directories — these are newer Wine builds
    // (e.g. Wine-BattleNet-11.0 with bin/wine). Check them before .app bundles
    // so they take priority when both exist in the same tree.
    for (const name of entries) {
      if (name === '.DS_Store' || name.endsWith('.app')) continue
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
    // Second pass: .app bundles (legacy layout with Contents/Resources/wine/bin)
    for (const name of entries) {
      if (!name.endsWith('.app')) continue
      const binDir = join(root, name, 'Contents/Resources/wine/bin')
      for (const exe of ['wine64', 'wine']) {
        const candidate = join(binDir, exe)
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function folderSize(path: string): number {
  if (!existsSync(path)) return 0
  let total = 0
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (st.isFile()) total += st.size
        else if (st.isDirectory()) walk(p)
      } catch {
        /* ignore */
      }
    }
  }
  walk(path)
  return total
}

export function resolveActiveWineRoot(): string | null {
  const versionId = getActiveVersionId()
  if (versionId) {
    const release = findRelease(versionId)
    if (release?.install_dir && existsSync(release.install_dir)) {
      return release.install_dir
    }
    // Safety net: catalog install_dir was stale/missing. Try to find a
    // directory matching the active version name under the install root.
    if (release) {
      const root = installRootForType(release.type)
      const expectedDir = join(root, versionId.replace(/\//g, '_').replace(/ /g, '_'))
      if (existsSync(expectedDir) && findWine64InTree(expectedDir)) {
        return expectedDir
      }
    }
  }
  for (const release of loadCatalog() as WineRelease[]) {
    if (release.is_installed && release.install_dir) {
      if (existsSync(release.install_dir) && findWine64InTree(release.install_dir)) {
        return release.install_dir
      }
    }
  }
  if (findWine64InTree(WINE_DIR)) return WINE_DIR
  return null
}

export function migrateLegacyInstall(): void {
  if (!findWine64InTree(WINE_DIR)) return
  const catalog = loadCatalog() as WineRelease[]
  for (const entry of catalog) {
    if (entry.is_installed && entry.install_dir) {
      if (findWine64InTree(entry.install_dir)) return
    }
  }
  const legacyVersion = 'Wine-legacy'
  catalog.unshift({
    version: legacyVersion,
    type: 'Wine-Staging-macOS',
    repository_id: 'wine-staging-macos',
    date: '',
    download: '',
    downsize: 0,
    disksize: folderSize(WINE_DIR),
    checksum: '',
    release_notes_link: '',
    is_installed: true,
    has_update: false,
    install_dir: WINE_DIR
  })
  saveCatalog(catalog)
  if (!getActiveVersionId()) setActiveVersionId(legacyVersion)
}

export function markInstalled(version: string, installDir: string): void {
  const catalog = loadCatalog() as WineRelease[]
  for (const release of catalog) {
    if (release.version === version) {
      release.is_installed = true
      release.install_dir = installDir
      release.disksize = folderSize(installDir)
      release.has_update = false
      saveCatalog(catalog)
      return
    }
  }
  throw new Error(`Version not in catalog: ${version}`)
}

export function markRemoved(version: string): void {
  const catalog = loadCatalog() as WineRelease[]
  const active = getActiveVersionId()
  for (const release of catalog) {
    if (release.version === version) {
      release.is_installed = false
      release.install_dir = ''
      release.disksize = 0
      release.has_update = false
      saveCatalog(catalog)
      if (active === version) {
        const next = catalog.find((r) => r.is_installed && r.install_dir)
        setActiveVersionId(next?.version ?? null)
      }
      return
    }
  }
  throw new Error(`Version not in catalog: ${version}`)
}
