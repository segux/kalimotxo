export const app = {
  isPackaged: false,
  getAppPath: () => process.cwd(),
  getVersion: () => '0.0.0',
  getName: () => 'Kalimotxo',
  getPath: (name: string) => `/tmp/kalimotxo-test/${name}`,
  on: jest.fn(),
  whenReady: () => Promise.resolve(),
}

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
}

export const shell = {
  openExternal: jest.fn(),
  openPath: jest.fn(),
}

export const BrowserWindow = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(),
  webContents: { send: jest.fn() },
  on: jest.fn(),
}))

export const dialog = {
  showOpenDialog: jest.fn(),
  showSaveDialog: jest.fn(),
  showMessageBox: jest.fn(),
}

export const nativeTheme = {
  themeSource: 'system',
  shouldUseDarkColors: false,
}
