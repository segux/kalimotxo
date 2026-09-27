import type { WineRelease } from '../types'

let catalog: WineRelease[] = []
let active: string | null = null

jest.mock('../catalog', () => ({
  loadCatalog: () => catalog,
  saveCatalog: (c: WineRelease[]) => {
    catalog = c
  },
  getActiveVersionId: () => active,
  setActiveVersionId: (v: string | null) => {
    active = v
  },
  findRelease: (v: string) => catalog.find((r) => r.version === v) ?? null
}))
const installed: string[] = []
let published: WineRelease[] = []
jest.mock('../manager', () => ({
  refreshWineReleases: async () => published,
  installWineVersionSync: async (v: string) => {
    installed.push(v)
    const r = catalog.find((x) => x.version === v)
    if (r) r.is_installed = true
    return { success: true, message: 'ok' }
  },
  setActiveWineVersion: (v: string) => {
    active = v
  }
}))
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: () => true }))
jest.mock('../../../logger', () => ({ logInfo: () => {} }))

import { ensureBattleNetReadyWine, migrateKalimotxoWineCatalog } from '../kalimotxoWine'

const DL = 'https://github.com/segux/kalimotxo/releases/download/wine-cx-26.1.0/wine-cx-26.1.0.tar.xz'
const release = (over: Partial<WineRelease>): WineRelease => ({
  version: '',
  type: 'Wine-BattleNet',
  repository_id: 'wine-battlenet',
  date: '2026-09-27',
  download: '',
  downsize: 0,
  disksize: 0,
  checksum: '',
  release_notes_link: '',
  is_installed: false,
  has_update: false,
  install_dir: '',
  ...over
})

describe('migrateKalimotxoWineCatalog', () => {
  it('renames early Battle.net Wine entries and follows the active one', () => {
    catalog = [
      release({ version: 'Wine-BattleNet-latest', download: DL, is_installed: true, install_dir: '/w/Wine-BattleNet-latest' }),
      release({ version: 'Wine-BattleNet-CX-26.1.0', download: DL }),
      release({ version: 'Wine-BattleNet-11.0', is_installed: true, install_dir: '/w/Wine-BattleNet-11.0' }),
      release({ version: 'Wine-Staging-macOS-latest', type: 'Wine-Staging-macOS', download: 'https://x/staging.tar.xz' })
    ]
    active = 'Wine-BattleNet-latest'

    migrateKalimotxoWineCatalog()

    expect(catalog.map((r) => r.version).sort()).toEqual([
      'Kalimotxo-Wine-26.1.0',
      'Wine-BattleNet-11.0',
      'Wine-Staging-macOS-latest'
    ])
    const kw = catalog.find((r) => r.version === 'Kalimotxo-Wine-26.1.0')!
    // The installed alias wins and keeps its install dir: nothing is re-downloaded.
    expect(kw).toMatchObject({
      type: 'Kalimotxo-Wine',
      repository_id: 'kalimotxo-wine',
      is_installed: true,
      install_dir: '/w/Wine-BattleNet-latest'
    })
    expect(active).toBe('Kalimotxo-Wine-26.1.0')
  })

  it('does nothing when there is nothing to migrate', () => {
    catalog = [release({ version: 'Wine-BattleNet-11.0', is_installed: true })]
    active = 'Wine-BattleNet-11.0'
    migrateKalimotxoWineCatalog()
    expect(catalog.map((r) => r.version)).toEqual(['Wine-BattleNet-11.0'])
    expect(active).toBe('Wine-BattleNet-11.0')
  })
})

describe('ensureBattleNetReadyWine upgrades', () => {
  const kw = (version: string, over: Partial<WineRelease> = {}): WineRelease =>
    release({ version, type: 'Kalimotxo-Wine', repository_id: 'kalimotxo-wine', download: 'https://x/y.tar.xz', ...over })

  beforeEach(() => {
    installed.length = 0
  })

  it('moves an active Kalimotxo Wine to a newer revision', async () => {
    catalog = [kw('Kalimotxo-Wine-26.1.0', { is_installed: true, install_dir: '/w/a' }), kw('Kalimotxo-Wine-26.1.0-2')]
    published = catalog
    active = 'Kalimotxo-Wine-26.1.0'
    expect(await ensureBattleNetReadyWine(() => {})).toBe(true)
    expect(installed).toEqual(['Kalimotxo-Wine-26.1.0-2'])
    expect(active).toBe('Kalimotxo-Wine-26.1.0-2')
  })

  it('keeps a hand-installed Battle.net Wine as it is', async () => {
    catalog = [release({ version: 'Wine-BattleNet-11.0', is_installed: true, install_dir: '/w/b' }), kw('Kalimotxo-Wine-26.1.0-2')]
    published = catalog
    active = 'Wine-BattleNet-11.0'
    expect(await ensureBattleNetReadyWine(() => {})).toBe(true)
    expect(installed).toEqual([])
    expect(active).toBe('Wine-BattleNet-11.0')
  })

  it('does nothing when already on the newest build', async () => {
    catalog = [kw('Kalimotxo-Wine-26.1.0-2', { is_installed: true, install_dir: '/w/c' })]
    published = catalog
    active = 'Kalimotxo-Wine-26.1.0-2'
    await ensureBattleNetReadyWine(() => {})
    expect(installed).toEqual([])
  })
})
