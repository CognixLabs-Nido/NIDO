'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MesSelector } from '@/features/cuotas-config/components/MesSelector'
import { formatEuros } from '@/shared/lib/format-money'

import { cerrarMes } from '../actions/cerrar-mes'
import type { CierreMesResumen } from '../queries/get-cierre-mes'
import { ReciboEsporadicoDialog } from './ReciboEsporadicoDialog'

interface Props {
  centroId: string
  anio: number
  mes: number
  resumen: CierreMesResumen
  ninos: Array<{ id: string; nombre: string }>
}

export function CierrePanel({ anio, mes, resumen, ninos }: Props) {
  const t = useTranslations('cierre_cobros')
  const tErrors = useTranslations()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmarCierre() {
    startTransition(async () => {
      const r = await cerrarMes({ anio, mes })
      if (r.success) {
        toast.success(t('cerrado_ok'))
        setConfirmOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MesSelector anio={anio} mes={mes} tab="cierre" />
        <ReciboEsporadicoDialog anio={anio} mes={mes} ninos={ninos} />
      </div>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground text-base font-semibold">{t('estado_titulo')}</h2>
          {resumen.cerrado ? (
            <Badge variant="secondary">{t('cerrado')}</Badge>
          ) : (
            <Badge variant="warm">{t('abierto')}</Badge>
          )}
        </div>

        {resumen.cerrado ? (
          <p className="text-muted-foreground text-sm">
            {t('resumen_cerrado', {
              num: resumen.numRecibos,
              total: formatEuros(resumen.totalCentimos),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t('aviso_cerrar')}</p>
        )}

        {!resumen.cerrado && (
          <div>
            <Button onClick={() => setConfirmOpen(true)}>{t('cerrar_mes')}</Button>
          </div>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('confirm_title')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t('confirm_desc')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={pending} onClick={confirmarCierre}>
              {pending ? t('cerrando') : t('cerrar_mes')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
