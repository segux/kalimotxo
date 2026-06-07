import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

import { CACHE_DIR } from '../../config/paths'
import { sendFrontendMessage } from '../../ipc'
import { resetWineInstallationCache } from '../../launcher/wineRunner'
import {
  findRelease,
  getActiveVersionId,
  loadCatalog,
  saveCatalog,
  setActiveVersionId
} from './catalog'
import {
  findWine64InTree,
  installDirForVersion,
  installRootForType,
  markInstalled,
  markRemoved,
  migrateLegacyInstall,
  resolveActiveWineRoot
} from './installed'
import { fetchRepositoryReleases, mergeReleaseLists } from './releases'
import { MACOS_REPOSITORIES } from './repositories'
import type { WineInstallStatus, WineRelease } from './types'

let installState: WineInstallStatus = {
  running: false,
  version: '',
  status: 'idle',
  percent: 0,
  message: ''
}

function setInstallState(partial: Partial<WineInstallStatus>): void {
  installState = { ...installState, ...partial }
  sendFrontendMessage('wineInstallProgress', { ...installState })
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  mkdirSync(join(dest, '..'), { recursive: true })
  const file = createWriteStream(dest)
  let done = 0
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')
  while (true) {
    const { done: d, value } = await reader.read()
    if (d) break
    done += value.length
    file.write(Buffer.from(value))
    if (total && onProgress) onProgress(Math.min(99, Math.floor((done / total) * 100)))
  }
  file.end()
  await new Promise<void>((resolve, reject) => {
    file.on('finish', () => resolve())
    file.on('error', reject)
  })
}

function extractTar(archive: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  if (archive.endsWith('.tar.xz')) {
    execSync(`tar -xJf "${archive}" -C "${dest}"`, { stdio: 'pipe' })
  } else {
    execSync(`tar -xzf "${archive}" -C "${dest}"`, { stdio: 'pipe' })
  }
}

export function isMacSonomaOrHigher(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    const v = execSync('sw_vers -productVersion', { encoding: 'utf-8' }).trim()
    const major = parseInt(v.split('.')[0] ?? '0', 10)
    return major >= 14
  } catch {
    return false
  }
}

/** Heroic: Intel or macOS < Sonoma -> Wine-Crossover; Apple Silicon Sonoma+ -> GPTK. */
export function pickHeroicDefaultWineVersion(catalog?: WineRelease[]): string | null {
  if (process.platform !== 'darwin') return null
  const list = catalog ?? loadCatalog()
  const preferCrossover = process.arch === 'x64' || !isMacSonomaOrHigher()
  const primary = preferCrossover ? 'Wine-Crossover-latest' : 'Game-Porting-Toolkit-latest'
  if (list.some((r) => r.version === primary && r.download)) return primary
  const staging = 'Wine-Staging-macOS-latest'
  if (list.some((r) => r.version === staging && r.download)) return staging
  const any = list.find((r) => r.version.endsWith('-latest') && r.download)
  return any?.version ?? null
}

export function listRepositories() {
  return MACOS_REPOSITORIES.map((r) => ({
    id: r.id,
    name: r.name,
    typeLabel: r.typeLabel
  }))
}

export function listInstalled(): WineRelease[] {
  migrateLegacyInstall()
  return loadCatalog().filter((r) => r.is_installed)
}

export function getActiveVersion(): {
  version: string
  type: string
  install_dir: string
  wine64: string | null
} | null {
  migrateLegacyInstall()
  const versionId = getActiveVersionId()
  const root = resolveActiveWineRoot()
  const wine64 = root ? findWine64InTree(root) : null
  if (versionId) {
    const release = findRelease(versionId)
    if (release) {
      return {
        version: versionId,
        type: release.type,
        install_dir: release.install_dir,
        wine64
      }
    }
  }
  if (root && wine64) {
    return {
      version: versionId ?? 'Wine-legacy',
      type: 'Wine-Staging-macOS',
      install_dir: root,
      wine64
    }
  }
  return null
}

export async function refreshWineReleases(repositoryIds?: string[]): Promise<WineRelease[]> {
  migrateLegacyInstall()
  const repos = repositoryIds?.length
    ? MACOS_REPOSITORIES.filter((r) => repositoryIds.includes(r.id))
    : MACOS_REPOSITORIES
  const existing = loadCatalog()
  const fetched: WineRelease[] = []
  for (const repo of repos) {
    fetched.push(...(await fetchRepositoryReleases(repo)))
  }
  const merged = mergeReleaseLists(existing, fetched)
  saveCatalog(merged)
  return merged
}

export function getWineInstallStatus(): WineInstallStatus {
  return { ...installState }
}

export async function installWineVersionSync(
  version: string,
  options?: { overwrite?: boolean; onProgress?: (pct: number, msg: string) => void }
): Promise<{ success: boolean; message: string }> {
  const release = findRelease(version)
  if (!release) {
    return { success: false, message: 'Version not found — refresh the catalog' }
  }
  if (!release.download) {
    return { success: false, message: 'No download URL' }
  }

  const wineType = release.type
  const installDir = installDirForVersion(version, wineType)
  mkdirSync(installRootForType(wineType), { recursive: true })

  if (
    existsSync(installDir) &&
    findWine64InTree(installDir) &&
    !options?.overwrite
  ) {
    markInstalled(version, installDir)
    if (!getActiveVersionId()) setActiveVersionId(version)
    resetWineInstallationCache()
    return { success: true, message: `${version} was already installed` }
  }

  const archiveName = release.download.split('/').pop() ?? 'wine.tar.gz'
  const archive = join(CACHE_DIR, 'wine-downloads', archiveName)
  mkdirSync(join(CACHE_DIR, 'wine-downloads'), { recursive: true })

  const progress = (pct: number, msg: string) => {
    options?.onProgress?.(pct, msg)
    setInstallState({ status: 'downloading', percent: pct, message: msg })
  }

  try {
    progress(0, `Downloading ${archiveName}...`)
    await downloadFile(release.download, archive, (p) =>
      progress(p, `Downloading ${archiveName}...`)
    )
    setInstallState({ status: 'extracting', percent: 100, message: 'Extracting...' })
    if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true })
    extractTar(archive, installDir)
    if (!findWine64InTree(installDir)) {
      return { success: false, message: 'Extraction OK but wine64 not found' }
    }
    markInstalled(version, installDir)
    if (!getActiveVersionId()) setActiveVersionId(version)
    resetWineInstallationCache()
    return { success: true, message: `${version} installed` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, message: msg }
  }
}

export function installWineVersion(
  version: string,
  options?: { overwrite?: boolean }
): { success: boolean; message: string } {
  if (installState.running) {
    return { success: false, message: 'A Wine installation is already in progress' }
  }
  setInstallState({
    running: true,
    version,
    status: 'downloading',
    percent: 0,
    message: 'Starting...'
  })
  void (async () => {
    const result = await installWineVersionSync(version, options)
    setInstallState({
      running: false,
      status: result.success ? 'done' : 'error',
      percent: result.success ? 100 : installState.percent,
      message: result.message
    })
    sendFrontendMessage('wineInstallFinished', result)
  })()
  return { success: true, message: `Installing ${version}...` }
}

export function setActiveWineVersion(version: string): { success: boolean; message: string } {
  const release = findRelease(version)
  if (!release?.is_installed) {
    return { success: false, message: 'That version is not installed' }
  }
  if (!findWine64InTree(release.install_dir)) {
    return { success: false, message: 'wine64 not found in the directory' }
  }
  setActiveVersionId(version)
  resetWineInstallationCache()
  return { success: true, message: `Active Wine: ${version}` }
}

export function removeWineVersion(version: string): { success: boolean; message: string } {
  const release = findRelease(version)
  if (!release?.is_installed) {
    return { success: false, message: 'Version not installed' }
  }
  if (release.install_dir && existsSync(release.install_dir)) {
    rmSync(release.install_dir, { recursive: true, force: true })
  }
  markRemoved(version)
  resetWineInstallationCache()
  return { success: true, message: `${version} removed` }
}

/** Setup: Wine-Crossover (Heroic) or GPTK depending on hardware, with Staging legacy fallback. */
export async function ensureHeroicDefaultWine(
  onProgress?: (pct: number, msg: string) => void
): Promise<{ success: boolean; message: string }> {
  migrateLegacyInstall()
  if (resolveActiveWineRoot() && findWine64InTree(resolveActiveWineRoot()!)) {
    return { success: true, message: 'Wine already available' }
  }
  onProgress?.(5, 'Updating Wine catalog...')
  await refreshWineReleases()
  const version = pickHeroicDefaultWineVersion()
  if (version) {
    onProgress?.(10, `Installing ${version}...`)
    const result = await installWineVersionSync(version, {
      onProgress: (p, m) => onProgress?.(10 + Math.floor(p * 0.85), m)
    })
    if (result.success) return result
  }
  return { success: false, message: 'Could not install default Wine (Heroic)' }
}
