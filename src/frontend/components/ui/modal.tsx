import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

export function Modal({
  title,
  onClose,
  children,
  dismissable = true
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** False while a long operation runs: Esc and the backdrop do nothing. */
  dismissable?: boolean
}) {
  const { t } = useTranslation('common')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissable])

  return (
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#15151b] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
              aria-label={t('actions.close')}
            >
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
