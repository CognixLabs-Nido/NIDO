'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

import type { VistaAgenda } from '../types'

const VISTAS: VistaAgenda[] = ['dia', 'semana', 'mes']

interface Props {
  vista: VistaAgenda
  onChange: (vista: VistaAgenda) => void
}

/** Conmutador de vista día/semana/mes (AG-06). El padre persiste la preferencia. */
export function VistaToggle({ vista, onChange }: Props) {
  const t = useTranslations('citas')
  return (
    <div className="border-border inline-flex rounded-md border p-0.5" role="tablist">
      {VISTAS.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === vista}
          onClick={() => onChange(v)}
          className={cn(
            'rounded px-3 py-1 text-sm',
            v === vista
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`vista.${v}`)}
        </button>
      ))}
    </div>
  )
}
