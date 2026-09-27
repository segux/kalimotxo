import { fetchRepositoryReleases } from '../releases'
import { REPO_BY_ID } from '../repositories'

const asset = (name: string) => ({
  name,
  browser_download_url: `https://example.test/${name}`,
  size: 100
})

describe('fetchRepositoryReleases (Kalimotxo Wine)', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('keeps only wine-cx-* releases from the app repo and names them', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: 'v1.2.0', assets: [asset('Kalimotxo-1.2.0-arm64.dmg')] },
        {
          tag_name: 'wine-cx-26.1.0',
          published_at: '2026-09-27T00:00:00Z',
          // The source tarball comes first on purpose: it must not be picked.
          assets: [
            asset('crossover-sources-26.1.0.tar.gz'),
            asset('wine-cx-26.1.0.tar.xz'),
            asset('wine-cx-26.1.0.tar.xz.sha512sum')
          ]
        }
      ]
    }) as unknown as typeof fetch

    const releases = await fetchRepositoryReleases(REPO_BY_ID['kalimotxo-wine'])
    // Listed by its real version, no `-latest` alias.
    expect(releases.map((r) => r.version)).toEqual(['Kalimotxo-Wine-26.1.0'])
    expect(releases[0]).toMatchObject({
      type: 'Kalimotxo-Wine',
      download: 'https://example.test/wine-cx-26.1.0.tar.xz',
      checksum: 'https://example.test/wine-cx-26.1.0.tar.xz.sha512sum'
    })
  })
})
