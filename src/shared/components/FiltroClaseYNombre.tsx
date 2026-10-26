'use client'

import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'

interface Props {
  /** Las clases de la lista (`clasesDe`). Sin clases, solo sale la búsqueda. */
  clases: string[]
  aula: string | null
  onAula: (aula: string | null) => void
  texto: string
  onTexto: (texto: string) => void
}

/**
 * Filtro de una lista de niños del centro: un botón por clase («Todas» incluida) y búsqueda por
 * nombre. Se usa con `filtrarNinos`.
 */
export function FiltroClaseYNombre({ clases, aula, onAula, texto, onTexto }: Props) {
  const t = useTranslations('common.filtro_ninos')
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {clases.length > 0 && (
        <div role="group" aria-label={t('clase')} className="flex flex-wrap gap-2">
          {[null, ...clases].map((c) => (
            <button
              key={c ?? 'todas'}
              type="button"
              aria-pressed={aula === c}
              onClick={() => onAula(c)}
              className={[
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                aula === c
                  ? 'border-primary-500 bg-primary-100 text-primary-800'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              ].join(' ')}
            >
              {c ?? t('todas')}
            </button>
          ))}
        </div>
      )}
      <Input
        type="search"
        value={texto}
        onChange={(e) => onTexto(e.target.value)}
        placeholder={t('buscar')}
        aria-label={t('buscar')}
        className="sm:w-56"
      />
    </div>
  )
}
