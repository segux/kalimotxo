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
jest.mock('../manager', () => ({}))
jest.mock('../../../logger', () => ({ logInfo: () => {} }))

import { migrateKalimotxoWineCatalog } from '../kalimotxoWine'

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
