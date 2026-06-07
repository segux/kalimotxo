import { execSync, spawnSync } from 'child_process'

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

export function applyBattleNetUrlProtocols(bottleName = BATTLENET_BOTTLE): void {
  const wine = getWineBinary(bottleName)
  const env = buildEnv(bottleName)
  const wineZ = spawnSync(wine, ['winepath', '-w', wine], { env, encoding: 'utf-8' })
    .stdout?.trim()
  const browserCmd = wineZ
    ? `"${wineZ}" "%1"`
    : '"C:\\windows\\system32\\winebrowser.exe" "%1"'

  for (const proto of ['battlenet', 'blizzard']) {
    const root = `HKCR\\${proto}`
    spawnSync(wine, ['reg', 'add', root, '/ve', '/d', `URL:${proto}`, '/f'], { env })
    spawnSync(wine, ['reg', 'add', root, '/v', 'URL Protocol', '/d', '', '/f'], { env })
    spawnSync(
      wine,
      ['reg', 'add', `${root}\\shell\\open\\command`, '/ve', '/d', browserCmd, '/f'],
      { env }
    )
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
