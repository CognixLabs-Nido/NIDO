'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatEuros } from '@/shared/lib/format-money'

import { marcarTransferenciaRealizada } from '../actions/transferencias'
import { etiquetaMes } from '../lib/meses'
import type { TransferenciasBecaData } from '../queries/get-transferencias-beca'

interface Props {
  data: TransferenciasBecaData
}

/**
 * V2-5 — Listado de transferencias de beca comedor en la pestaña Remesas: pendientes de
 * devolver (con botón "marcar realizada") + realizadas con su sello. Solo admin/dirección.
 */
export function TransferenciasBecaPanel({ data }: Props) {
  const t = useTranslations('remesas.transferencias_beca')
  const tRoot = useTranslations()
  const locale = useLocale()
  const [pending, startTransition] = useTransition()

  function marcar(id: string) {
    startTransition(async () => {
      const r = await marcarTransferenciaRealizada({ id })
      if (r.success) toast.success(t('marcada_ok'))
      else toast.error(tRoot(r.error))
    })
  }

  const total = data.pendientes.length + data.realizadas.length

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-foreground text-base font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('sub')}</p>
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground text-sm">{t('sin_transferencias')}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {data.pendientes.map((tr) => (
            <div
              key={tr.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="flex items-center gap-2">
                <Badge variant="warm">{t('pendiente')}</Badge>
                <span className="font-medium">{tr.familiaEtiqueta}</span>
                <span className="text-muted-foreground text-xs">
                  {etiquetaMes(locale, tr.anio, tr.mes)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatEuros(tr.importeCentimos, locale)}</span>
                <Button size="sm" disabled={pending} onClick={() => marcar(tr.id)}>
                  {t('marcar_realizada')}
                </Button>
              </span>
            </div>
          ))}
          {data.realizadas.map((tr) => (
            <div
              key={tr.id}
              className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="flex items-center gap-2">
                <Badge variant="success">{t('realizada')}</Badge>
                <span className="font-medium">{tr.familiaEtiqueta}</span>
                <span className="text-xs">{etiquetaMes(locale, tr.anio, tr.mes)}</span>
              </span>
              <span className="tabular-nums">{formatEuros(tr.importeCentimos, locale)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
