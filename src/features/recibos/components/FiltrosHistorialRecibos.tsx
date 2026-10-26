'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { hrefHistorial, type FiltroHistorial } from '../lib/filtro-historial'
import { nombreMes } from '../lib/formato'

import type { OpcionHistorial } from '../queries/get-opciones-historial'

/** Valor de «sin filtro» en los selectores (ni un año, ni un mes, ni un uuid se llaman así). */
const TODOS = 'todos'

interface Props {
  filtro: FiltroHistorial
  anios: number[]
  familias: OpcionHistorial[]
  ninos: OpcionHistorial[]
}

/**
 * Filtros del histórico general de recibos (F-6): año, mes, familia y niño. Viven en la URL; la
 * página lee con ellos en el servidor. Cambiar uno vuelve a la primera página.
 */
export function FiltrosHistorialRecibos({ filtro, anios, familias, ninos }: Props) {
  const t = useTranslations('admin.recibos')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  function cambiar(campo: keyof Omit<FiltroHistorial, 'pagina'>, valor: string) {
    const v = valor === TODOS ? null : valor
    const siguiente: FiltroHistorial = {
      ...filtro,
      [campo]: campo === 'anio' || campo === 'mes' ? (v ? Number(v) : null) : v,
      pagina: 1,
    }
    startTransition(() => router.push(hrefHistorial(pathname, siguiente)))
  }

  const selectores: Array<{
    campo: keyof Omit<FiltroHistorial, 'pagina'>
    etiqueta: string
    valor: string
    items: Array<{ value: string; label: string }>
  }> = [
    {
      campo: 'anio',
      etiqueta: t('filtro_anio'),
      valor: filtro.anio ? String(filtro.anio) : TODOS,
      items: [
        { value: TODOS, label: t('todos_los_anios') },
        ...anios.map((a) => ({ value: String(a), label: String(a) })),
      ],
    },
    {
      campo: 'mes',
      etiqueta: t('filtro_mes'),
      valor: filtro.mes ? String(filtro.mes) : TODOS,
      items: [
        { value: TODOS, label: t('todos_los_meses') },
        ...Array.from({ length: 12 }, (_, i) => ({
          value: String(i + 1),
          label: nombreMes(i + 1, locale),
        })),
      ],
    },
    {
      campo: 'familiaId',
      etiqueta: t('filtro_familia'),
      valor: filtro.familiaId ?? TODOS,
      items: [
        { value: TODOS, label: t('todas_las_familias') },
        ...familias.map((f) => ({ value: f.id, label: f.etiqueta })),
      ],
    },
    {
      campo: 'ninoId',
      etiqueta: t('filtro_nino'),
      valor: filtro.ninoId ?? TODOS,
      items: [
        { value: TODOS, label: t('todos_los_ninos') },
        ...ninos.map((n) => ({ value: n.id, label: n.etiqueta })),
      ],
    },
  ]
  const hayFiltro = filtro.anio || filtro.mes || filtro.familiaId || filtro.ninoId

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      {selectores.map((s) => (
        <div key={s.campo} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium">{s.etiqueta}</span>
          <Select
            items={s.items}
            value={s.valor}
            onValueChange={(v) => cambiar(s.campo, v as string)}
          >
            <SelectTrigger size="sm" className="w-48" aria-label={s.etiqueta}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {hayFiltro && (
        <Link
          href={pathname}
          className="text-muted-foreground hover:text-foreground pb-1.5 text-sm font-medium underline"
        >
          {t('quitar_filtros')}
        </Link>
      )}
    </div>
  )
}
