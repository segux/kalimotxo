import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  asNativeDll,
  installDxmtNextToExe,
  installWinemetal,
  peArchDir,
  removeStaleDxmtNextToExe
} from '../dxmt'

/** Minimal PE: MZ header, builtin marker at 0x40, PE header at 0x80. */
function pe(machine: number, builtin = true): Buffer {
  const b = Buffer.alloc(0x100)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(0x80, 0x3c)
  if (builtin) b.write('Wine builtin DLL', 0x40, 'latin1')
  b.write('PE\0\0', 0x80, 'latin1')
  b.writeUInt16LE(machine, 0x84)
  return b
}

describe('dxmt', () => {
  let root: string
  let dxmt: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dxmt-'))
    dxmt = join(root, 'dxmt')
    for (const [arch, machine] of [['x86_64-windows', 0x8664], ['i386-windows', 0x14c]] as const) {
      mkdirSync(join(dxmt, arch), { recursive: true })
      for (const dll of ['d3d11', 'dxgi', 'd3d10core', 'winemetal']) {
        writeFileSync(join(dxmt, arch, `${dll}.dll`), pe(machine))
      }
    }
    mkdirSync(join(dxmt, 'x86_64-unix'))
    writeFileSync(join(dxmt, 'x86_64-unix', 'winemetal.so'), 'so')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('detects the PE machine', () => {
    expect(peArchDir(pe(0x8664))).toBe('x86_64-windows')
    expect(peArchDir(pe(0x14c))).toBe('i386-windows')
    expect(peArchDir(Buffer.from('not a pe'))).toBeNull()
  })

  it('strips the Wine builtin marker so the DLL loads as native', () => {
    const native = asNativeDll(pe(0x8664))
    expect(native.toString('latin1', 0x40, 0x50)).not.toContain('Wine builtin')
    expect(peArchDir(native)).toBe('x86_64-windows')
  })

  it('puts native DXMT next to the exe for its architecture', () => {
    const game = join(root, 'game')
    mkdirSync(game)
    writeFileSync(join(game, 'Game.exe'), pe(0x14c, false))
    expect(installDxmtNextToExe(join(game, 'Game.exe'), dxmt).sort()).toEqual(['d3d10core.dll', 'd3d11.dll', 'dxgi.dll'])
    const d3d11 = readFileSync(join(game, 'd3d11.dll'))
    expect(peArchDir(d3d11)).toBe('i386-windows')
    expect(d3d11.toString('latin1', 0x40, 0x50)).not.toContain('Wine builtin')
    expect(existsSync(join(game, 'winemetal.dll'))).toBe(false)
    // Idempotent.
    expect(installDxmtNextToExe(join(game, 'Game.exe'), dxmt)).toEqual([])
  })

  it('adds winemetal to the Wine install, builtin', () => {
    const wine = join(root, 'wine')
    for (const sub of ['x86_64-windows', 'i386-windows', 'x86_64-unix']) {
      mkdirSync(join(wine, 'lib', 'wine', sub), { recursive: true })
    }
    expect(installWinemetal(wine, dxmt)).toHaveLength(3)
    const dll = readFileSync(join(wine, 'lib', 'wine', 'x86_64-windows', 'winemetal.dll'))
    expect(dll.toString('latin1', 0x40, 0x50)).toBe('Wine builtin DLL')
    expect(installWinemetal(wine, dxmt)).toEqual([])
  })
})

describe('removeStaleDxmtNextToExe', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dxmt-stale-'))
    writeFileSync(join(dir, 'Game.exe'), '')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('removes the DXMT set (they import winemetal.dll)', () => {
    writeFileSync(join(dir, 'd3d11.dll'), 'MZ ... winemetal.dll')
    writeFileSync(join(dir, 'dxgi.dll'), 'MZ ... winemetal.dll')
    writeFileSync(join(dir, 'd3d10core.dll'), 'MZ ... D3D11CoreCreateDevice')
    expect(removeStaleDxmtNextToExe(join(dir, 'Game.exe')).sort()).toEqual([
      'd3d10core.dll',
      'd3d11.dll',
      'dxgi.dll'
    ])
    expect(existsSync(join(dir, 'd3d11.dll'))).toBe(false)
  })

  it('never touches a game\'s own D3D DLLs', () => {
    writeFileSync(join(dir, 'd3d11.dll'), 'MZ some other d3d11')
    writeFileSync(join(dir, 'd3d10core.dll'), 'MZ game d3d10core')
    expect(removeStaleDxmtNextToExe(join(dir, 'Game.exe'))).toEqual([])
    expect(existsSync(join(dir, 'd3d10core.dll'))).toBe(true)
  })
})
