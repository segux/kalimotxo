import { wineserverSibling } from '../wineserverPath'

describe('wineserverSibling', () => {
  it.each([
    ['/w/bin/wine', '/w/bin/wineserver'],
    ['/w/bin/wine64', '/w/bin/wineserver'],
    ['/Apps/Wine Staging.app/Contents/Resources/wine/bin/wine', '/Apps/Wine Staging.app/Contents/Resources/wine/bin/wineserver']
  ])('%s -> %s', (bin, expected) => {
    expect(wineserverSibling(bin)).toBe(expected)
  })
})
