import { cn } from '../../lib/utils'

const ICON_SRC = `${import.meta.env.BASE_URL}brand/kalimotxo-icon.png`
const LOGO_SRC = `${import.meta.env.BASE_URL}brand/kalimotxo-logo.svg`

export type KalimotxoLogoVariant = 'icon' | 'full'

export function KalimotxoLogo({
  variant = 'icon',
  size = variant === 'icon' ? 36 : 200,
  className,
  animated = false
}: {
  variant?: KalimotxoLogoVariant
  size?: number
  className?: string
  animated?: boolean
}) {
  const src = variant === 'icon' ? ICON_SRC : LOGO_SRC
  const height = variant === 'icon' ? size : Math.round(size * (48 / 280))

  return (
    <img
      src={src}
      alt="Kalimotxo"
      width={size}
      height={height}
      draggable={false}
      className={cn(
        'select-none object-contain',
        animated && 'kal-logo-animated',
        className
      )}
    />
  )
}
