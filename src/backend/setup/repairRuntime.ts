import { CACHE_DIR } from '../config/paths'
import { BATTLENET_BOTTLE } from '../storeManagers/battlenet/constants'
import { syncLaunchRuntime } from '../storeManagers/battlenet/deps'
import { resetWineInstallationCache, stopWineProcesses } from '../launcher/wineRunner'
import {
  getDownloadStatus,
  isSetupComplete,
  downloadComponent
} from './runtime'
import { resolveDxmtCacheArchive } from './downloadArchive'
import { isDxmtInstalled } from './runtimePaths'

export async function repairRuntime(): Promise<{ success: boolean; message: string }> {
  const steps: string[] = []

  try {
    stopWineProcesses(BATTLENET_BOTTLE, { wait: false })
    steps.push('Wine processes stopped')
  } catch {
    /* ignore */
  }

  const linked = resolveDxmtCacheArchive(CACHE_DIR)
  if (linked) steps.push('DXMT cache linked')

  if (!isDxmtInstalled()) {
    const r = await downloadComponent('dxmt')
    if (!r.success) {
      return { success: false, message: `DXMT: ${r.message}` }
    }
    steps.push('DXMT instalado')
  } else {
    steps.push('DXMT OK')
  }

  const d3d = await downloadComponent('d3dmetal')
  if (d3d.success) steps.push('D3DMetal OK')
  else steps.push(`D3DMetal: ${d3d.message}`)

  try {
    const mirrored = syncLaunchRuntime()
    if (mirrored.length) steps.push(`DLL: ${mirrored.slice(0, 4).join(', ')}`)
    resetWineInstallationCache()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    steps.push(`DLL sync: ${msg}`)
  }

  const status = getDownloadStatus()
  const ok = isSetupComplete()
  const summary = Object.entries(status)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' ')

  return {
    success: ok,
    message: ok
      ? `Runtime repaired. ${summary}`
      : `Incomplete runtime. ${summary} — ${steps.join(' · ')}`
  }
}
