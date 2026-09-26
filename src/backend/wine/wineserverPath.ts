import type { WineInstallation } from './types'

/**
 * `…/bin/wine` or `…/bin/wine64` -> `…/bin/wineserver`.
 * Note `/wine64?$/` would be wrong: it means "wine6" plus an optional "4", so
 * a plain `wine` binary (Wine 11, Staging) was left untouched and the "server"
 * ended up being `wine` itself.
 */
export function wineserverSibling(wineBin: string): string {
  return wineBin.replace(/wine(64)?$/, 'wineserver')
}

export function resolveWineserver(installation: WineInstallation): string {
  return installation.wineserver ?? wineserverSibling(installation.bin)
}
