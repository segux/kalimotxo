import { useTranslation } from 'react-i18next'
import type { LibraryGraphicsBackend } from 'common/types/library'

export const BACKENDS: LibraryGraphicsBackend[] = ['dxmt', 'd3dmetal', 'wined3d-gl', 'wined3d']

/** Graphics layer picker. `auto` lets the backend detect it from the .exe. */
export function BackendSelect({
  value,
  onChange,
  allowAuto = false
}: {
  value: LibraryGraphicsBackend | 'auto'
  onChange: (v: LibraryGraphicsBackend | 'auto') => void
  allowAuto?: boolean
}) {
  const { t } = useTranslation('stores')
  return (
    <label className="block text-sm">
      <span className="text-white/60">{t('library.graphics')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LibraryGraphicsBackend | 'auto')}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white"
      >
        {allowAuto && <option value="auto">{t('library.backend.auto')}</option>}
        {BACKENDS.map((b) => (
          <option key={b} value={b}>
            {t(`library.backend.${b}`)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block text-sm">
      <span className="text-white/60">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/25"
      />
    </label>
  )
}
