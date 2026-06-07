import { isWizardSkipped, setWizardSkipped } from '../config/wizardPrefs'
import { checkAll } from '../system/checks'
import { runInstallAndWait } from '../storeManagers/battlenet/service'
import { getDownloadStatus, isSetupComplete } from './runtime'
import { ensureRuntimeReady } from './ensureEnvironment'
import { cabextractAvailable, gstreamerAvailable } from './toolPaths'

function isSystemDepsReady(): boolean {
  return cabextractAvailable() && gstreamerAvailable()
}
import { sendFrontendMessage } from '../ipc'

export interface SetupWizardState {
  system_ready: boolean
  runtime_ready: boolean
  wizard_complete: boolean
  /** User chose to explore the app without completing the wizard. */
  wizard_skipped: boolean
  checks: ReturnType<typeof checkAll>
  download_status: Record<string, boolean>
}

export function getSetupWizardState(): SetupWizardState {
  const system_ready = isSystemDepsReady()
  const runtime_ready = isSetupComplete()
  const wizard_complete = system_ready && runtime_ready
  return {
    system_ready,
    runtime_ready,
    wizard_complete,
    wizard_skipped: isWizardSkipped(),
    checks: checkAll(),
    download_status: getDownloadStatus()
  }
}

/** Permite entrar al launcher sin instalar Wine ni dependencias. */
export function skipSetupWizard(): { success: boolean; message: string } {
  setWizardSkipped(true)
  return { success: true, message: 'wizard_skipped' }
}

export interface RunSetupWizardOptions {
  /** After the runtime, launch the automated Battle.net installation (Blizzard wizard runs separately). */
  installBattleNet?: boolean
}

export async function runSetupWizard(
  onLog?: (message: string) => void,
  options: RunSetupWizardOptions = {}
): Promise<{ success: boolean; message: string }> {
  const log = onLog ?? (() => {})

  sendFrontendMessage('setupProgress', {
    component: 'system',
    percent: 0,
    message: 'Checking system dependencies…'
  })

  sendFrontendMessage('setupProgress', {
    component: 'system',
    percent: 10,
    message: 'Preparing tools and runtime…'
  })

  const [rtOk, rtMsg] = await ensureRuntimeReady(log)
  if (!rtOk) {
    sendFrontendMessage('setupProgress', {
      component: 'system',
      percent: 0,
      message: rtMsg
    })
    return { success: false, message: rtMsg }
  }

  sendFrontendMessage('setupProgress', {
    component: 'system',
    percent: 100,
    message: 'System and runtime ready'
  })

  sendFrontendMessage('setupProgress', {
    component: 'runtime',
    percent: 100,
    message: 'Kalimotxo runtime ready'
  })

  const state = getSetupWizardState()
  if (!state.wizard_complete) {
    return {
      success: false,
      message: 'Incomplete setup. Check cabextract, GStreamer and the downloads.'
    }
  }

  if (options.installBattleNet !== false) {
    sendFrontendMessage('setupProgress', {
      component: 'battlenet',
      percent: 0,
      message: 'setup.progress.battlenetStarting'
    })
    log('Installing Battle.net (Wine, dependencies, Blizzard installer)…')
    const bn = await runInstallAndWait()
    sendFrontendMessage('setupProgress', {
      component: 'battlenet',
      percent: bn.success ? 100 : 0,
      message: bn.message
    })
    if (!bn.success) {
      return {
        success: false,
        message: bn.message
      }
    }
    return {
      success: true,
      message:
        'Kalimotxo installed Battle.net. If a Wine window appears, complete the Blizzard wizard to download games.'
    }
  }

  return { success: true, message: 'Kalimotxo is ready. You can now install Battle.net.' }
}
