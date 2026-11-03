'use client'

import { useState, useTransition } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatEuros } from '@/shared/lib/format-money'

import { leerAvisoReabrir } from '../actions/leer-aviso-reabrir'
import { reabrirRemesa } from '../actions/reabrir-remesa'
import type { AvisoReabrir } from '../lib/aviso-reabrir'

interface Props {
  remesaId: string
}

/**
 * «Reabrir» una remesa (solo la admin del centro). Al abrirse lee el aviso y, hasta tenerlo, no
 * hay botón de confirmar: la admin ve ANTES de pulsar a cuántas familias afecta y por cuánto, el
 * riesgo de cobrar dos veces según lo que sabe NIDO de la remesa, y por su nombre a las familias
 * que no se tocan porque ya pagaron o ya pasaron por el banco. Confirmar manda los números que vio;
 * si la remesa cambió entre medias, no se reabre y el aviso se vuelve a leer con los de ahora.
 */
export function ReabrirRemesaDialog({ remesaId }: Props) {
  const t = useTranslations('remesas.reabrir')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [aviso, setAviso] = useState<AvisoReabrir | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leyendo, startLeer] = useTransition()
  const [reabriendo, startReabrir] = useTransition()

  function leer() {
    startLeer(async () => {
      const r = await leerAvisoReabrir({ remesaId })
      if (r.success) setAviso(r.data)
      else {
        setAviso(null)
        setError(tErrors(r.error))
      }
    })
  }

  function onOpenChange(abierto: boolean) {
    setOpen(abierto)
    if (abierto) {
      setAviso(null)
      setError(null)
      leer()
    }
  }

  function confirmar() {
    if (!aviso) return
    setError(null)
    startReabrir(async () => {
      const r = await reabrirRemesa({
        remesaId,
        nRecibos: aviso.resumen.n_recibos,
        totalCentimos: aviso.resumen.total_centimos,
      })
      if (r.success) {
        toast.success(
          r.data.nAPendiente === null
            ? t('reabierta_sin_numero')
            : t('reabierta', { num: r.data.nAPendiente })
        )
        setOpen(false)
        return
      }
      setError(tErrors(r.error))
      if (r.error === 'remesas.errors.remesa_cambiada') {
        // Lo que vio ya no es la remesa: se le enseñan los números de ahora antes de confirmar.
        setAviso(null)
        startLeer(async () => {
          const otra = await leerAvisoReabrir({ remesaId })
          if (otra.success) setAviso(otra.data)
        })
      }
    })
  }

  const r = aviso?.resumen

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            {t('boton')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('titulo')}</DialogTitle>
          <DialogDescription>{t('que_pasa')}</DialogDescription>
        </DialogHeader>

        {leyendo && !aviso && <p className="text-muted-foreground text-sm">{t('leyendo')}</p>}

        {aviso && r && (
          <div className="space-y-3 text-sm">
            <div role="note" className="space-y-1 rounded-md border border-amber-300 p-3">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>{t(`caso.${aviso.caso}`, { fecha: r.fecha_envio_banco ?? '' })}</span>
              </p>
              <p>
                {t('afecta', {
                  familias: r.n_familias,
                  recibos: r.n_recibos,
                  total: formatEuros(r.total_centimos, locale),
                })}
              </p>
            </div>

            {aviso.noSeTocan.length > 0 && (
              <div className="space-y-1">
                <p>{t('no_se_tocan', { num: aviso.noSeTocan.length })}</p>
                <ul className="divide-y rounded-md border">
                  {aviso.noSeTocan.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-3 p-2">
                      <span>
                        <span className="font-medium">{n.familiaEtiqueta || '—'}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {t(`estado.${n.estado}`)}
                        </span>
                      </span>
                      <span className="tabular-nums">{formatEuros(n.totalCentimos, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancelar')}
          </Button>
          {aviso && (
            <Button
              type="button"
              variant="destructive-strong"
              disabled={reabriendo || leyendo}
              onClick={confirmar}
            >
              {t('confirmar')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
