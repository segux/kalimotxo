import { appendFileSync } from 'fs'
import { BATTLENET_BOTTLE } from '../storeManagers/battlenet/constants'
import { prepareBottleForLauncher } from '../storeManagers/battlenet/launcherPrep'
import { applyBattleNetWindowsRegistry } from '../launcher/wineRunner'
import { resolveBattleNetWineInstallation } from './compatibilityLayers'
import { verifyWinePrefix } from './verifyPrefix'
import { prepareBattleNetOAuthForMac } from '../storeManagers/battlenet/oauthSetup'
import { syncLaunchRuntime } from '../storeManagers/battlenet/deps'

export function prepareBattleNetWineLaunch(logPath?: string): {
  ok: boolean
  message: string
} {
  const log = (m: string): void => {
    if (logPath) appendFileSync(logPath, m + '\n')
  }

  try {
    const installation = resolveBattleNetWineInstallation()
    log(`Wine: ${installation.name} (${installation.type})`)

    prepareBattleNetOAuthForMac(log)

    prepareBottleForLauncher()
    const runtime = syncLaunchRuntime()
    if (runtime.length) log(`Runtime: ${runtime.join(', ')}`)
    const prefixCheck = verifyWinePrefix(BATTLENET_BOTTLE, installation)
    log(prefixCheck.message)
    if (!prefixCheck.ok) return { ok: false, message: prefixCheck.message }
    applyBattleNetWindowsRegistry(BATTLENET_BOTTLE)

    return { ok: true, message: `Listo con ${installation.name}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(msg)
    return { ok: false, message: msg }
  }
}
