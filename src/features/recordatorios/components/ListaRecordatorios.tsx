'use client'

import { RecordatorioItem } from './RecordatorioItem'
import type { RecordatorioListItem } from '../types'

interface Props {
  titulo: string
  items: RecordatorioListItem[]
  userId: string
  locale: string
  emptyLabel: string
  testid?: string
}

/**
 * Renderiza una sección de recordatorios (pendientes o completados). Presentacional:
 * recibe la lista ya filtrada por el contenedor. Estado vacío amable.
 */
export function ListaRecordatorios({ titulo, items, userId, locale, emptyLabel, testid }: Props) {
  return (
    <section data-testid={testid}>
      {titulo && (
        <h2 className="mb-2 text-sm font-semibold tracking-wide uppercase opacity-70">
          {titulo} {items.length > 0 && <span className="opacity-60">({items.length})</span>}
        </h2>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <RecordatorioItem key={item.id} item={item} userId={userId} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  )
}
