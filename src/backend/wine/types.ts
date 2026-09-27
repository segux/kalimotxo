export type WineLayerType = 'wine' | 'toolkit'

export interface WineInstallation {
  bin: string
  wineserver?: string
  name: string
  type: WineLayerType
}
