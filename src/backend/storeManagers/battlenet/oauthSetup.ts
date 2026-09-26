import { execSync, spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getBottlePath } from '../../bottle'
import { buildEnv, getWineBinary } from '../../launcher/wineRunner'
import { resetBattleNetProgramData } from './agent'
import { BATTLENET_BOTTLE } from './constants'
import { ensureOAuthBrowserScript } from './oauthBrowserScript'

export { ensureOAuthBrowserScript } from './oauthBrowserScript'

export function hostnameResolvesToLoopback(): { ok: boolean; hostname: string; hint?: string } {
  if (process.platform !== 'darwin') return { ok: true, hostname: '' }
  try {
    const hostname = execSync('hostname', { encoding: 'utf-8' }).trim()
    const out = execSync(`dscacheutil -q host -a name ${hostname}`, {
      encoding: 'utf-8',
      timeout: 5000
    })
    const ok = /127\.0\.0\.1/.test(out) || /\nip:\s*127\./.test(out)
    if (ok) return { ok: true, hostname }
    return {
      ok: false,
      hostname,
      hint: `Add "127.0.0.1 ${hostname}" to /etc/hosts (recommended for Battle.net login in Wine).`
    }
  } catch {
    return { ok: true, hostname: '' }
  }
}

const URL_PROTOCOLS_MARKER = '.kalimotxo-url-protocols'

/**
 * Registers battlenet:// and blizzard:// in the prefix. Runs once per Wine
 * binary (the handler command embeds its path): each `wine reg` call cold-starts
 * a wineserver, which used to add several seconds to every launch.
 */
export function applyBattleNetUrlProtocols(bottleName = BATTLENET_BOTTLE): void {
  try {
    const wine = getWineBinary(bottleName)
    const marker = join(getBottlePath(bottleName), URL_PROTOCOLS_MARKER)
    if (existsSync(marker) && readFileSync(marker, 'utf-8').trim() === wine) return
    const env = buildEnv(bottleName)
    // 8s cap: wineserver cold-start can be slow; URL protocol registration is
    // non-critical so we must not block the main process waiting indefinitely.
    const TIMEOUT = 8_000
    const wineZ = spawnSync(wine, ['winepath', '-w', wine], {
      env,
      encoding: 'utf-8',
      timeout: TIMEOUT
    }).stdout?.trim()
    const browserCmd = wineZ
      ? `"${wineZ}" "%1"`
      : '"C:\\windows\\system32\\winebrowser.exe" "%1"'

    for (const proto of ['battlenet', 'blizzard']) {
      const root = `HKCR\\${proto}`
      spawnSync(wine, ['reg', 'add', root, '/ve', '/d', `URL:${proto}`, '/f'], {
        env,
        timeout: TIMEOUT
      })
      spawnSync(wine, ['reg', 'add', root, '/v', 'URL Protocol', '/d', '', '/f'], {
        env,
        timeout: TIMEOUT
      })
      spawnSync(
        wine,
        ['reg', 'add', `${root}\\shell\\open\\command`, '/ve', '/d', browserCmd, '/f'],
        { env, timeout: TIMEOUT }
      )
    }
    if (wineZ) writeFileSync(marker, wine + '\n')
  } catch {
    // Non-critical: URL protocols are cosmetic (battlenet:// deep links).
    // A timeout here must not abort the launch.
  }
}

export function clearBattleNetOAuthCache(bottleName = BATTLENET_BOTTLE): boolean {
  return resetBattleNetProgramData(bottleName)
}

export function prepareBattleNetOAuthForMac(log?: (m: string) => void): void {
  if (process.platform !== 'darwin') return
  const script = ensureOAuthBrowserScript()
  log?.(`OAuth browser: ${script}`)
  applyBattleNetUrlProtocols()
  const host = hostnameResolvesToLoopback()
  if (!host.ok && host.hint) log?.(`Hostname warning: ${host.hint}`)
}
