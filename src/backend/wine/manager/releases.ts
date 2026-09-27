import { existsSync } from 'fs'

import type { WineRepository } from './repositories'
import type { WineRelease } from './types'

/** Tag prefix of the Wine builds published by Kalimotxo's own CI. */
export const BATTLENET_WINE_TAG_PREFIX = 'wine-cx-'

function versionName(wineType: string, tag: string): string {
  if (wineType === 'Wine-BattleNet') {
    return `Wine-BattleNet-CX-${tag.slice(BATTLENET_WINE_TAG_PREFIX.length)}`
  }
  if (wineType.includes('Wine')) return `Wine-${tag}`
  return tag
}

function pickAssets(
  wineType: string,
  assets: { name: string; browser_download_url: string; size: number }[],
  tag = ''
): { download: string; downsize: number; checksum: string } {
  let download = ''
  let downsize = 0
  let checksum = ''
  if (wineType === 'Wine-BattleNet') {
    // Our releases also attach the CrossOver source tarball: pick the build by name.
    const build = assets.find((a) => a.name === `${tag}.tar.xz`)
    const sum = assets.find((a) => a.name === `${tag}.tar.xz.sha512sum`)
    return {
      download: build?.browser_download_url ?? '',
      downsize: build?.size ?? 0,
      checksum: sum?.browser_download_url ?? ''
    }
  }
  if (wineType === 'Wine-Staging-macOS') {
    const staging = assets.find((a) => a.name.toLowerCase().includes('staging'))
    if (staging) {
      download = staging.browser_download_url
      downsize = staging.size
    }
  }
  for (const asset of assets) {
    const name = asset.name
    if (name.endsWith('sha512sum')) {
      checksum = asset.browser_download_url
    } else if (
      !download &&
      (name.endsWith('.tar.gz') || name.endsWith('.tar.xz'))
    ) {
      download = asset.browser_download_url
      downsize = asset.size
    }
  }
  return { download, downsize, checksum }
}

export async function fetchRepositoryReleases(
  repo: WineRepository,
  count = 40
): Promise<WineRelease[]> {
  try {
    const res = await fetch(`${repo.apiUrl}?per_page=${count}`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      tag_name?: string
      published_at?: string
      html_url?: string
      assets?: { name: string; browser_download_url: string; size: number }[]
    }[]
    const releases: WineRelease[] = []
    for (const release of data) {
      const tag = release.tag_name ?? ''
      if (!tag) continue
      // The app's own releases live in the same repo: keep only Wine builds.
      if (repo.id === 'wine-battlenet' && !tag.startsWith(BATTLENET_WINE_TAG_PREFIX)) continue
      const { download, downsize, checksum } = pickAssets(
        repo.typeLabel,
        release.assets ?? [],
        tag
      )
      if (!download) continue
      releases.push({
        version: versionName(repo.typeLabel, tag),
        type: repo.typeLabel,
        repository_id: repo.id,
        date: (release.published_at ?? '').slice(0, 10),
        download,
        downsize,
        disksize: 0,
        checksum,
        release_notes_link: release.html_url ?? '',
        is_installed: false,
        has_update: false,
        install_dir: ''
      })
    }
    if (!releases.length) return releases
    const latest =
      releases.find((r) => /\d+-\d+$/.test(r.version)) ?? releases[0]
    releases.unshift({
      ...latest,
      version: `${latest.type}-latest`
    })
    return releases
  } catch {
    return []
  }
}

export function mergeReleaseLists(
  existing: WineRelease[],
  fetched: WineRelease[]
): WineRelease[] {
  const byVersion = new Map<string, WineRelease>()
  for (const r of fetched) {
    if (r.version) byVersion.set(r.version, { ...r })
  }
  const fetchedIds = new Set(byVersion.keys())
  for (const old of existing) {
    const version = old.version
    const installDir = old.install_dir ?? ''
    const pathOk = installDir.length > 0 && existsInstallDir(installDir)
    if (byVersion.has(version) && old.is_installed && pathOk) {
      const merged = byVersion.get(version)!
      merged.install_dir = installDir
      merged.is_installed = true
      merged.disksize = old.disksize || merged.disksize
      if (
        merged.checksum &&
        old.checksum &&
        merged.checksum !== old.checksum
      ) {
        merged.has_update = true
      }
    } else if (old.is_installed && pathOk) {
      byVersion.set(version, { ...old })
    } else if (!fetchedIds.has(version) && !old.is_installed) {
      /* drop stale */
    }
  }
  return [...byVersion.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function existsInstallDir(path: string): boolean {
  return existsSync(path)
}
