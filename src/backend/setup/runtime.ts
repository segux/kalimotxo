import { chmodSync, existsSync, mkdirSync, rmSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { execSync } from 'child_process'
import {
  downloadWithCurl,
  isDxmtArchiveComplete,
  isGzipArchiveValid,
  resolveDxmtCacheArchive
} from './downloadArchive'
import {
  CACHE_DIR,
  DOWNLOAD_URLS,
  DXMT_DIR,
  DXVK_DIR,
  RUNTIME_DIR,
  WINE_DIR,
  WINETRICKS_PATH
} from '../config/paths'
import { logInfo } from '../logger'
import { sendFrontendMessage } from '../ipc'
import { ensureWinetricksInRuntime } from './toolPaths'
import {
  findWine64,
  findWine64InTree,
  isD3dmetalInstalled,
  isDxmtInstalled,
  isDxvkInstalled,
  isWineInstalled
} from './runtimePaths'

export { findWine64, isWineInstalled } from './runtimePaths'

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading`)

  const expected = Number(res.headers.get('content-length') || 0)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('Response has no body')

  const chunks: Buffer[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const buf = Buffer.from(value)
    chunks.push(buf)
    received += buf.length
    if (expected > 0 && onProgress) {
      onProgress(Math.min(99, Math.floor((received / expected) * 100)))
    }
  }

  const data = Buffer.concat(chunks)
  if (expected > 0 && received !== expected) {
    throw new Error(`Incomplete download (${received} / ${expected} bytes)`)
  }
  if (received < 1024) {
    throw new Error('Download too small (invalid file)')
  }

  await writeFile(dest, data)
}

export function isSetupComplete(): boolean {
  return (
    isWineInstalled() &&
    existsSync(WINETRICKS_PATH) &&
    (isDxmtInstalled() || isDxvkInstalled() || isD3dmetalInstalled())
  )
}

export function getDownloadStatus(): Record<string, boolean> {
  return {
    wine: isWineInstalled(),
    dxmt: isDxmtInstalled(),
    dxvk: isDxvkInstalled(),
    d3dmetal: isD3dmetalInstalled(),
    winetricks: existsSync(WINETRICKS_PATH)
  }
}

async function extractTarXz(archive: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true })
  execSync(`tar -xJf "${archive}" -C "${dest}"`, { stdio: 'pipe' })
}

async function extractTarGz(archive: string, dest: string, verifyDxmt = false): Promise<void> {
  const valid = verifyDxmt ? isDxmtArchiveComplete(archive) : isGzipArchiveValid(archive)
  if (!valid) {
    rmSync(archive, { force: true })
    throw new Error(
      'Cached .tar.gz is corrupt or incomplete. Click Download again (it will be deleted and retried).'
    )
  }
  mkdirSync(dest, { recursive: true })
  try {
    execSync(`tar -xzf "${archive}" -C "${dest}"`, { stdio: 'pipe', timeout: 300_000 })
  } catch (e) {
    rmSync(archive, { force: true })
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      msg.includes('truncated')
        ? 'DXMT: file corrupted during download. Click DXMT again (will use curl).'
        : msg
    )
  }
}

export async function downloadComponent(component: string): Promise<{ success: boolean; message: string }> {
  const url = DOWNLOAD_URLS[component]
  if (!url) return { success: false, message: `Unknown component: ${component}` }

  mkdirSync(CACHE_DIR, { recursive: true })
  mkdirSync(RUNTIME_DIR, { recursive: true })

  const progress = (pct: number, msg: string) => {
    sendFrontendMessage('setupProgress', { component, percent: pct, message: msg })
  }

  try {
    if (component === 'wine') {
      const archive = join(CACHE_DIR, 'wine-staging.tar.xz')
      progress(0, 'setup.progress.downloadingWine')
      await downloadFile(url, archive, (p) => progress(p, 'setup.progress.downloadingWinePct'))
      progress(50, 'setup.progress.extractingWine')
      mkdirSync(WINE_DIR, { recursive: true })
      await extractTarXz(archive, WINE_DIR)
      if (!findWine64InTree(WINE_DIR)) {
        return { success: false, message: 'Wine extracted but wine/wine64 not found in the bundle' }
      }
      progress(100, 'setup.progress.wineInstalled')
    } else if (component === 'dxmt') {
      if (isDxmtInstalled()) {
        progress(100, 'setup.progress.dxmtInstalled')
        return { success: true, message: 'DXMT already installed' }
      }
      const archive = join(CACHE_DIR, 'dxmt.tar.gz')
      resolveDxmtCacheArchive(CACHE_DIR)
      if (existsSync(archive) && !isDxmtArchiveComplete(archive)) {
        rmSync(archive, { force: true })
      }
      if (!isDxmtArchiveComplete(archive)) {
        progress(0, 'setup.progress.downloadingDxmt')
        try {
          downloadWithCurl(url, archive)
        } catch (e) {
          rmSync(archive, { force: true })
          const msg = e instanceof Error ? e.message : String(e)
          return { success: false, message: `DXMT: download failed (${msg})` }
        }
        progress(90, 'setup.progress.downloadingDxmtPct')
        if (!isDxmtArchiveComplete(archive)) {
          rmSync(archive, { force: true })
          return {
            success: false,
            message: 'DXMT: incomplete or corrupt download. Check your network and retry.'
          }
        }
      }
      progress(50, 'setup.progress.extractingDxmt')
      await extractTarGz(archive, DXMT_DIR, true)
      if (!isDxmtInstalled()) {
        return { success: false, message: 'DXMT extracted but DLL folders not found' }
      }
      progress(100, 'setup.progress.dxmtInstalled')
    } else if (component === 'dxvk') {
      const archive = join(CACHE_DIR, 'dxvk.tar.gz')
      await downloadFile(url, archive)
      await extractTarGz(archive, DXVK_DIR)
    } else if (component === 'winetricks') {
      progress(0, 'setup.progress.installingWinetricks')
      if (!ensureWinetricksInRuntime(WINETRICKS_PATH)) {
        await downloadFile(url, WINETRICKS_PATH)
        chmodSync(WINETRICKS_PATH, 0o755)
      }
      progress(100, 'setup.progress.winetricksReady')
    } else if (component === 'd3dmetal') {
      const { ensureD3dmetal } = await import('../wine/d3dmetalSetup')
      progress(0, 'setup.progress.d3dmetalSearching')
      const [ok, msg] = await ensureD3dmetal({
        onLog: (m) => progress(50, m)
      })
      progress(ok ? 100 : 0, msg)
      return { success: ok, message: msg }
    } else {
      return { success: false, message: `Component ${component} not implemented` }
    }
    logInfo(`Setup: ${component} OK`)
    return { success: true, message: `${component} installed` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, message: msg }
  }
}

export async function downloadAll(): Promise<{ success: boolean; message: string }> {
  const { ensureHeroicDefaultWine } = await import('../wine/manager/manager')
  const progress = (pct: number, msg: string) => {
    sendFrontendMessage('setupProgress', {
      component: 'wine',
      percent: pct,
      message: msg
    })
  }
  const wineResult = await ensureHeroicDefaultWine(progress)
  if (!wineResult.success) {
    const legacy = await downloadComponent('wine')
    if (!legacy.success) return legacy
  }
  for (const c of ['dxmt', 'winetricks']) {
    const r = await downloadComponent(c)
    if (!r.success) return r
  }

  const { ensureD3dmetal } = await import('../wine/d3dmetalSetup')
  sendFrontendMessage('setupProgress', {
    component: 'd3dmetal',
    percent: 0,
    message: 'setup.progress.d3dmetalSearching'
  })
  const [d3dOk, d3dMsg] = await ensureD3dmetal({
    onLog: (m) =>
      sendFrontendMessage('setupProgress', {
        component: 'd3dmetal',
        percent: 50,
        message: m
      })
  })
  sendFrontendMessage('setupProgress', {
    component: 'd3dmetal',
    percent: d3dOk ? 100 : 0,
    message: d3dMsg
  })

  if (!isSetupComplete()) {
    return { success: false, message: 'Incomplete runtime after downloads' }
  }
  if (!d3dOk) {
    return {
      success: true,
      message: `Runtime ready (Wine/DXMT). D3DMetal: ${d3dMsg}`
    }
  }
  return { success: true, message: 'Runtime ready (includes D3DMetal)' }
}
