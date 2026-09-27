import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

declare global {
  // eslint-disable-next-line no-var
  var __LEGACY_ROOT__: string
  // eslint-disable-next-line no-var
  var __LEGACY_REGS__: string[]
}

jest.mock('../../bottle', () => ({
  getBottleConfig: () => ({ env_vars: {} }),
  getBottlePath: (name: string) => require('path').join(global.__LEGACY_ROOT__, name)
}))
jest.mock('../../launcher/wineRunner', () => ({
  getActiveWineInstallation: () => ({ bin: '/fake/wine/bin/wine', name: 'Wine 11', type: 'wine' }),
  buildEnv: () => ({}),
  getWineBinary: () => '/fake/wine/bin/wine'
}))
jest.mock('child_process', () => ({
  spawnSync: (_bin: string, args: string[]) => {
    const { join } = require('path')
    const { readFileSync } = require('fs')
    const file = String(args[2]).replace(/^C:\\/, '')
    global.__LEGACY_REGS__.push(readFileSync(join(global.__LEGACY_ROOT__, 'Games', 'drive_c', file), 'utf-8'))
    return { status: 0 }
  }
}))

import { applyLegacyEngineAppDefaults } from '../gameEnv'

function gameDir(files: string[]): string {
  const dir = join(global.__LEGACY_ROOT__, 'Games', 'drive_c', 'Game')
  mkdirSync(dir, { recursive: true })
  for (const f of files) writeFileSync(join(dir, f), '')
  return dir
}

beforeEach(() => {
  global.__LEGACY_ROOT__ = mkdtempSync(join(tmpdir(), 'legacy-engine-'))
  global.__LEGACY_REGS__ = []
  mkdirSync(join(global.__LEGACY_ROOT__, 'Games', 'drive_c'), { recursive: true })
})

afterEach(() => {
  rmSync(global.__LEGACY_ROOT__, { recursive: true, force: true })
})

describe('applyLegacyEngineAppDefaults', () => {
  it('presents the Diablo II engine exes as Windows XP, never the launcher', () => {
    const dir = gameDir(['PD2Launcher.exe', 'Game.exe', 'Diablo II.exe', 'Fog.dll', 'Storm.dll'])
    expect(applyLegacyEngineAppDefaults('Games', join(dir, 'PD2Launcher.exe'))).toBe(true)
    const reg = global.__LEGACY_REGS__.join('\n')
    expect(reg).toContain('[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\Game.exe]')
    expect(reg).toContain('[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\Diablo II.exe]')
    expect(reg).toContain('"Version"="winxp"')
    expect(reg).not.toContain('PD2Launcher.exe')
  })

  it('leaves games without the 1.13-era engine alone', () => {
    const dir = gameDir(['Game.exe', 'data.pak'])
    expect(applyLegacyEngineAppDefaults('Games', join(dir, 'Game.exe'))).toBe(false)
    expect(global.__LEGACY_REGS__).toEqual([])
  })

  it('matches file names case-insensitively', () => {
    const dir = gameDir(['game.exe', 'FOG.DLL'])
    expect(applyLegacyEngineAppDefaults('Games', join(dir, 'game.exe'))).toBe(true)
    expect(global.__LEGACY_REGS__.join('\n')).toContain('AppDefaults\\Game.exe]')
  })
})
