import type { IconType } from 'react-icons'
import { FaAmazon } from 'react-icons/fa6'
import { SiBattledotnet, SiEpicgames, SiGogdotcom, SiSteam } from 'react-icons/si'
import type { StoreId } from 'common/types/store'
import { cn } from '../../lib/utils'

const STORE_ICONS: Record<StoreId, IconType> = {
  battlenet: SiBattledotnet,
  epic: SiEpicgames,
  steam: SiSteam,
  gog: SiGogdotcom,
  amazon: FaAmazon
}

const BRAND_COLORS: Record<StoreId, string> = {
  battlenet: '#00AEFF',
  epic: '#FFFFFF',
  steam: '#FFFFFF',
  gog: '#FFFFFF',
  amazon: '#FF9900'
}

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'hero'

const sizePx: Record<Size, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56,
  hero: 120
}

export function StoreLogo({
  storeId,
  size = 'md',
  className,
  colored = true
}: {
  storeId: StoreId
  size?: Size
  className?: string
  /** Si false, hereda color del padre (p. ej. blanco en tarjetas). */
  colored?: boolean
}) {
  const Icon = STORE_ICONS[storeId]
  const px = sizePx[size]

  return (
    <Icon
      className={cn('shrink-0', className)}
      size={px}
      color={colored ? BRAND_COLORS[storeId] : 'currentColor'}
      aria-label={storeId}
    />
  )
}

export function getStoreBannerUrl(storeId: StoreId): string {
  return `${import.meta.env.BASE_URL}stores/banners/${storeId}.svg`
}
