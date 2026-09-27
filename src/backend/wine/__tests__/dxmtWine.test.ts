import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { buildDxmtWine } from '../dxmtWine'

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

describe('buildDxmtWine', () => {
  let root: string
  let wine: string
  let dxmt: string
  let dest: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dxmtwine-'))
    wine = join(root, 'wine')
    dxmt = join(root, 'dxmt')
    dest = join(root, 'out')
    write(join(wine, 'bin', 'wine'), 'loader')
    write(join(wine, 'lib', 'wine', 'x86_64-unix', 'ntdll.so'), 'ntdll')
    write(join(wine, 'lib', 'wine', 'x86_64-unix', 'wine'), 'unix loader')
    write(join(wine, 'lib', 'wine', 'x86_64-windows', 'd3d11.dll'), 'wine d3d11')
    write(join(wine, 'lib', 'wine', 'x86_64-windows', 'dxgi.dll'), 'wine dxgi')
    write(join(wine, 'lib', 'wine', 'i386-windows', 'd3d11.dll'), 'wine d3d11 32')
    symlinkSync('wine', join(wine, 'bin', 'wine64'))
    for (const arch of ['x86_64-windows', 'i386-windows']) {
      for (const dll of ['d3d11.dll', 'dxgi.dll', 'd3d10core.dll', 'winemetal.dll']) {
        write(join(dxmt, arch, dll), `dxmt ${arch} ${dll}`)
      }
    }
    write(join(dxmt, 'x86_64-unix', 'winemetal.so'), 'dxmt winemetal.so')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('mirrors Wine with DXMT in lib/wine and leaves the original untouched', () => {
    expect(buildDxmtWine(wine, join(wine, 'bin', 'wine'), dxmt, dest)).toBe(true)

    const lib = join(dest, 'lib', 'wine')
    expect(readFileSync(join(lib, 'x86_64-windows', 'd3d11.dll'), 'utf-8')).toBe(
      'dxmt x86_64-windows d3d11.dll'
    )
    expect(readFileSync(join(lib, 'i386-windows', 'dxgi.dll'), 'utf-8')).toBe(
      'dxmt i386-windows dxgi.dll'
    )
    expect(readFileSync(join(lib, 'x86_64-unix', 'winemetal.so'), 'utf-8')).toBe('dxmt winemetal.so')
    // The rest of Wine is hard-linked, and symlinks stay symlinks...
    const ntdll = join('lib', 'wine', 'x86_64-unix', 'ntdll.so')
    expect(statSync(join(dest, ntdll)).ino).toBe(statSync(join(wine, ntdll)).ino)
    // ...but the loaders are real copies: CrossOver keys its winetemp dir (and
    // the ntdll.so it links there) on the loader's inode/size/mtime.
    for (const loader of [join('bin', 'wine'), join('lib', 'wine', 'x86_64-unix', 'wine')]) {
      expect(statSync(join(dest, loader)).ino).not.toBe(statSync(join(wine, loader)).ino)
      expect(readFileSync(join(dest, loader), 'utf-8')).toBe(readFileSync(join(wine, loader), 'utf-8'))
    }
    expect(lstatSync(join(dest, 'bin', 'wine64')).isSymbolicLink()).toBe(true)

    expect(readFileSync(join(wine, 'lib', 'wine', 'x86_64-windows', 'd3d11.dll'), 'utf-8')).toBe(
      'wine d3d11'
    )
    expect(existsSync(join(wine, 'lib', 'wine', 'x86_64-unix', 'winemetal.so'))).toBe(false)
  })

  it('reuses the mirror until Wine changes', () => {
    buildDxmtWine(wine, join(wine, 'bin', 'wine'), dxmt, dest)
    const marker = join(dest, 'bin', 'extra')
    writeFileSync(marker, 'kept while nothing changes')
    buildDxmtWine(wine, join(wine, 'bin', 'wine'), dxmt, dest)
    expect(existsSync(marker)).toBe(true)

    // e.g. wineRuntimeLibs.ts adding MoltenVK to x86_64-unix
    write(join(wine, 'lib', 'wine', 'x86_64-unix', 'libMoltenVK.dylib'), 'mvk')
    buildDxmtWine(wine, join(wine, 'bin', 'wine'), dxmt, dest)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(join(dest, 'lib', 'wine', 'x86_64-unix', 'libMoltenVK.dylib'))).toBe(true)
  })

  it('refuses an incomplete DXMT', () => {
    rmSync(join(dxmt, 'x86_64-windows', 'dxgi.dll'))
    expect(buildDxmtWine(wine, join(wine, 'bin', 'wine'), dxmt, dest)).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })
})
