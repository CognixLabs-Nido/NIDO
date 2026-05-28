'use client'

import { useTranslations } from 'next-intl'

import type { AdminFamiliaListItem as AdminFamiliaListItemType } from '../types'

import { AdminFamiliaListItem } from './AdminFamiliaListItem'

interface Props {
  locale: string
  items: AdminFamiliaListItemType[]
}

/**
 * Sección "Dirección" para el tab Conversaciones del tutor. Encima del
 * split-view niño-céntrico, separada visualmente. Por defecto tendrá
 * 0 ó 1 item (un admin por par); en multi-admin (Ola 2) podría haber N.
 *
 * Si `items.length === 0` el componente NO se renderiza (no añadir ruido
 * visual cuando no hay hilos abiertos).
 */
export function AdminFamiliaSection({ locale, items }: Props) {
  const t = useTranslations('messages.admin_familia')
  if (items.length === 0) return null

  return (
    <section className="space-y-2" data-testid="admin-familia-section">
      <header>
        <h2 className="text-sm font-semibold">{t('seccion_titulo')}</h2>
        <p className="text-muted-foreground text-xs">{t('seccion_subtitulo')}</p>
      </header>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <AdminFamiliaListItem locale={locale} item={item} />
          </li>
        ))}
      </ul>
    </section>
  )
}
