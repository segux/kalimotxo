import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

/** Expected size of the dxmt-v0.74-builtin.tar.gz release on GitHub (bytes). */
export const DXMT_ARCHIVE_EXPECTED_BYTES = 18_990_005

export function isGzipArchiveValid(archivePath: string): boolean {
  if (!existsSync(archivePath)) return false
  try {
    execSync(`gzip -t "${archivePath}"`, { stdio: 'pipe', timeout: 120_000 })
    return true
  } catch {
    return false
  }
}

/** Verifies that the DXMT tar.gz can be listed and contains the key artifacts. */
export function isDxmtArchiveComplete(archivePath: string): boolean {
  if (!existsSync(archivePath)) return false
  try {
    const size = statSync(archivePath).size
    if (size < DXMT_ARCHIVE_EXPECTED_BYTES - 50_000) return false
    if (!isGzipArchiveValid(archivePath)) return false
    const listing = execSync(`tar -tzf "${archivePath}"`, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return (
      listing.includes('winemetal.so') &&
      listing.includes('winemetal.dll') &&
      listing.includes('i386-windows')
    )
  } catch {
    return false
  }
}

/** Reuses an already-downloaded DXMT .tar.gz from cache (handles varying filenames). */
export function resolveDxmtCacheArchive(cacheDir: string): string | null {
  const canonical = join(cacheDir, 'dxmt.tar.gz')
  if (isDxmtArchiveComplete(canonical)) return canonical

  try {
    for (const name of readdirSync(cacheDir)) {
      if (!name.toLowerCase().endsWith('.tar.gz')) continue
      if (!name.toLowerCase().includes('dxmt')) continue
      const path = join(cacheDir, name)
      if (isDxmtArchiveComplete(path)) {
        if (path !== canonical) {
          copyFileSync(path, canonical)
        }
        return canonical
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function downloadWithCurl(url: string, dest: string): void {
  const part = `${dest}.part`
  rmSync(part, { force: true })
  rmSync(dest, { force: true })
  execSync(
    `curl -fL --retry 3 --connect-timeout 30 --max-time 7200 -o "${part}" "${url}"`,
    { stdio: 'pipe', env: process.env, timeout: 7_200_000 }
  )
  renameSync(part, dest)
}
