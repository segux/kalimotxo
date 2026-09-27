import { app, BrowserWindow } from 'electron'
import path from 'path'
import { setMainWindow } from './ipc'
import { registerAllHandlers } from './handlers'
import { ensureDirectories } from './config/paths'

function cliTask(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--kalimotxo-cli='))
  return arg ? arg.slice('--kalimotxo-cli='.length) : null
}

async function runHeadlessCli(task: string): Promise<void> {
  ensureDirectories()
  registerAllHandlers()

  if (task === 'repair-launch' || task === 'repair') {
    const { repairRuntime } = await import('./setup/repairRuntime')
    console.log('[kalimotxo] repair runtime…')
    console.log(await repairRuntime())
  }

  if (task === 'repair-launch' || task === 'launch') {
    const { launch } = await import('./storeManagers/battlenet/service')
    console.log('[kalimotxo] launch battle.net…')
    console.log(await launch())
  }

  app.quit()
}

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  ensureDirectories()

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Kalimotxo',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  setMainWindow(mainWindow)
  mainWindow.on('closed', () => {
    setMainWindow(null)
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const preview =
      process.env.KALIMOTXO_UI_PREVIEW === '1' ? '?preview=1' : ''
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL + preview)
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../index.html'))
  }
}

app.whenReady().then(async () => {
  const task = cliTask()
  if (task) {
    try {
      await runHeadlessCli(task)
    } catch (e) {
      console.error(e)
      app.exit(1)
    }
    return
  }
  registerAllHandlers()
  const { migrateWineSettingsToKalimotxo } = await import('./wine/compatibilityLayers')
  migrateWineSettingsToKalimotxo()
  const { migrateKalimotxoWineCatalog } = await import('./wine/manager/kalimotxoWine')
  migrateKalimotxoWineCatalog()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => console.error(err))
  }
})
