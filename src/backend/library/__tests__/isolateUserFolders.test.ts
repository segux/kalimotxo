import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let fakeHome = ''
// Jest sandboxes process.env, so os.homedir() would still see the real HOME.
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => fakeHome }))
jest.mock('../../launcher/wineRunner', () => ({ getActiveWineInstallation: () => ({}) }))
jest.mock('../../storeManagers/battlenet/winetricksInstall', () => ({}))

import { isolateUserFolders } from '../bottle'

describe('isolateUserFolders', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'isolate-'))
    fakeHome = join(root, 'home')
    for (const d of ['Documents', 'Downloads']) mkdirSync(join(root, 'home', d), { recursive: true })
    mkdirSync(join(root, 'elsewhere'))
    const user = join(root, 'prefix', 'drive_c', 'users', 'crossover')
    mkdirSync(user, { recursive: true })
    symlinkSync(join(root, 'home', 'Documents'), join(user, 'Documents'))
    symlinkSync(join(root, 'home', 'Downloads'), join(user, 'Downloads'))
    symlinkSync(join(root, 'elsewhere'), join(user, 'Music')) // not in the Mac home
    mkdirSync(join(user, 'Desktop'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('replaces links to the Mac home folders with folders inside the bottle', () => {
    const changed = isolateUserFolders(join(root, 'prefix'))
    expect(changed.sort()).toEqual(['crossover/Documents', 'crossover/Downloads'])
    const user = join(root, 'prefix', 'drive_c', 'users', 'crossover')
    for (const d of ['Documents', 'Downloads']) {
      expect(lstatSync(join(user, d)).isDirectory()).toBe(true)
      expect(existsSync(join(user, d, '.kalimotxo'))).toBe(true)
    }
    // Links outside the Mac home and real folders are left alone.
    expect(lstatSync(join(user, 'Music')).isSymbolicLink()).toBe(true)
    // The Mac's own folders are untouched.
    expect(existsSync(join(root, 'home', 'Documents'))).toBe(true)
    expect(isolateUserFolders(join(root, 'prefix'))).toEqual([])
  })
})
