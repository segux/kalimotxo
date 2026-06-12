import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { CACHE_DIR, RUNTIME_DIR } from '../config/paths'
import { getBundledCabextractPath, getBundledWinetricksPath } from '../config/bundled'

const HOMEBREW_PATHS = ['/opt/homebrew/bin', '/usr/local/bin']

export const TOOLS_DIR = join(RUNTIME_DIR, 'tools')
export const BUNDLED_CABEXTRACT = join(TOOLS_DIR, 'cabextract')
export const BUNDLED_GST_LAUNCH = join(TOOLS_DIR, 'gst-launch-1.0')

const CABEXTRACT_BREW_BOTTLE_URL =
  'https://ghcr.io/v2/homebrew/core/cabextract/manifests/1.11'

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

/** Ruta efectiva de cabextract: bundle del app, sistema, o runtime local. */
export function resolveCabextractPath(): string | null {
  // 1. Binary bundled with the app (most reliable in packaged builds)
  const bundled = getBundledCabextractPath()
  if (bundled) return bundled
  // 2. Already copied to the user runtime dir
  if (existsSync(BUNDLED_CABEXTRACT)) return BUNDLED_CABEXTRACT
  // 3. System PATH (works in dev mode)
  const sys = which('cabextract')
  if (sys) return sys
  // 4. Known Homebrew locations (packaged app PATH may not include them)
  for (const dir of HOMEBREW_PATHS) {
    const p = join(dir, 'cabextract')
    if (existsSync(p)) return p
  }
  return null
}

export function resolveGstLaunchPath(): string | null {
  if (existsSync(BUNDLED_GST_LAUNCH)) return BUNDLED_GST_LAUNCH
  const sys = which('gst-launch-1.0')
  if (sys) return sys
  for (const dir of HOMEBREW_PATHS) {
    const p = join(dir, 'gst-launch-1.0')
    if (existsSync(p)) return p
  }
  return null
}

export function cabextractAvailable(): boolean {
  return resolveCabextractPath() !== null
}

export function gstreamerAvailable(): boolean {
  return resolveGstLaunchPath() !== null
}

/** Copia winetricks empaquetado o del repo al runtime del usuario. */
export function ensureWinetricksInRuntime(destPath: string): boolean {
  const bundled = getBundledWinetricksPath()
  if (!bundled) return false
  mkdirSync(join(destPath, '..'), { recursive: true })
  copyFileSync(bundled, destPath)
  chmodSync(destPath, 0o755)
  return true
}

/** Copia cabextract al runtime del usuario (desde bundle del app, Homebrew o PATH). */
export function copyCabextractFromSystem(): boolean {
  const src = getBundledCabextractPath() ?? which('cabextract') ??
    HOMEBREW_PATHS.map((d) => join(d, 'cabextract')).find(existsSync) ?? null
  if (!src) return false
  mkdirSync(TOOLS_DIR, { recursive: true })
  copyFileSync(src, BUNDLED_CABEXTRACT)
  chmodSync(BUNDLED_CABEXTRACT, 0o755)
  return true
}

/** Descarga cabextract arm64 desde bottle de Homebrew (sin brew instalado). */
export async function downloadCabextractBottle(
  onLog?: (msg: string) => void
): Promise<boolean> {
  if (existsSync(BUNDLED_CABEXTRACT)) return true

  const log = onLog ?? (() => {})
  try {
    log('Obteniendo cabextract para Apple Silicon…')
    const manifestRes = await fetch(CABEXTRACT_BREW_BOTTLE_URL, {
      headers: { Accept: 'application/vnd.oci.image.index.v1+json' }
    })
    if (!manifestRes.ok) return false
    const manifest = (await manifestRes.json()) as {
      manifests?: { platform: { architecture: string; os: string }; digest: string }[]
    }
    const arm = manifest.manifests?.find(
      (m) => m.platform?.architecture === 'arm64' && m.platform?.os === 'darwin'
    )
    if (!arm) return false

    const blobListRes = await fetch(
      `https://ghcr.io/v2/homebrew/core/cabextract/blobs/${arm.digest}`,
      { headers: { Accept: 'application/vnd.oci.image.manifest.v1+json' } }
    )
    if (!blobListRes.ok) return false
    const blobManifest = (await blobListRes.json()) as {
      layers?: { digest: string; size: number }[]
    }
    const layer = blobManifest.layers?.[0]
    if (!layer) return false

    const archivePath = join(CACHE_DIR, 'cabextract-bottle.tar.gz')
    mkdirSync(CACHE_DIR, { recursive: true })
    const blobUrl = `https://ghcr.io/v2/homebrew/core/cabextract/blobs/${layer.digest}`
    log('Descargando cabextract…')
    const blobRes = await fetch(blobUrl, {
      headers: { Accept: 'application/vnd.oci.image.layer.v1.tar+gzip' }
    })
    if (!blobRes.ok) return false
    const buf = Buffer.from(await blobRes.arrayBuffer())
    const { writeFileSync } = await import('fs')
    writeFileSync(archivePath, buf)

    const extractDir = join(CACHE_DIR, 'cabextract-extract')
    mkdirSync(extractDir, { recursive: true })
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' })

    let found = ''
    try {
      found = execSync(`find "${extractDir}" -name cabextract -type f 2>/dev/null | head -1`, {
        encoding: 'utf-8'
      }).trim()
    } catch {
      found = ''
    }
    if (!found || !existsSync(found)) return false

    mkdirSync(TOOLS_DIR, { recursive: true })
    copyFileSync(found, BUNDLED_CABEXTRACT)
    chmodSync(BUNDLED_CABEXTRACT, 0o755)
    log('cabextract instalado en Kalimotxo')
    return true
  } catch (e) {
    log(`cabextract: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
