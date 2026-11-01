'use client'

import { useState } from 'react'
import { LockIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatEuros } from '@/shared/lib/format-money'

import { bloqueoFechaRemesa, formatFechaCobro, resumenFechas } from '../lib/fecha-cobro'
import type { RemesaListItem } from '../queries/get-remesas-mes'
import { FechaCobroForm } from './FechaCobroForm'

interface Props {
  centroId: string
  remesa: Pick<RemesaListItem, 'estado' | 'ficheroGenerado' | 'recibos'>
}

/**
 * La fecha de cobro de una remesa: cuándo se cobra cada grupo de recibos y, si todavía se puede,
 * el botón para cambiarla (a todos o a los que se marquen). Si ya no se puede, dice por qué.
 */
export function RemesaFechaCobro({ centroId, remesa }: Props) {
  const t = useTranslations('remesas.fecha_cobro')
  const locale = useLocale()
  const [abierto, setAbierto] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const bloqueo = bloqueoFechaRemesa(remesa)

  const detalle = resumenFechas(remesa.recibos)
    .map(({ fecha, num }) =>
      t('cuantos', {
        fecha: fecha ? t('el', { fecha: formatFechaCobro(fecha, locale) }) : t('sin_fecha'),
        num,
      })
    )
    .join(' · ')

  function abrir(siguiente: boolean) {
    // Al abrir, todos marcados: lo normal es cambiar la remesa entera.
    if (siguiente) setMarcados(new Set(remesa.recibos.map((r) => r.id)))
    setAbierto(siguiente)
  }

  function toggle(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (remesa.recibos.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{t('se_cobra', { detalle })}</p>
      {bloqueo ? (
        <p className="text-muted-foreground flex items-start gap-1 text-xs">
          <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          {t(bloqueo)}
        </p>
      ) : (
        <Dialog open={abierto} onOpenChange={abrir}>
          <DialogTrigger
            render={
              <Button size="sm" variant="outline">
                {t('cambiar')}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('dialog_title')}</DialogTitle>
              <DialogDescription>{t('dialog_desc')}</DialogDescription>
            </DialogHeader>
            <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {remesa.recibos.map((r) => (
                <label key={r.id} className="flex items-center justify-between gap-3 p-2 text-sm">
                  <span className="flex items-center gap-3">
                    <Checkbox checked={marcados.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                    <span>
                      <span className="font-medium">{r.familiaEtiqueta}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {r.fechaCobro
                          ? t('el', { fecha: formatFechaCobro(r.fechaCobro, locale) })
                          : t('sin_fecha')}
                      </span>
                    </span>
                  </span>
                  <span className="tabular-nums">{formatEuros(r.totalCentimos, locale)}</span>
                </label>
              ))}
            </div>
            <FechaCobroForm
              centroId={centroId}
              reciboIds={[...marcados]}
              onHecho={() => setAbierto(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
