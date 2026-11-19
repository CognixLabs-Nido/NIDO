'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { pedirRefirmaFichaAction } from '../actions/firmar-ficha'
import type { EstadoFirmaFicha, UltimaFirmaFicha } from '../lib/ficha-firmada'

import { CopiaFichaFirmada } from './CopiaFichaFirmada'

interface Props {
  ninoId: string
  /** `null`: no se pudo leer. Se dice, y no se ofrece nada. */
  estado: EstadoFirmaFicha | null
  ultima: UltimaFirmaFicha | null
}

/**
 * La ficha firmada en la ficha del niño de Dirección (10b-2): si está firmada, cuándo y cómo, si
 * vale, si se pidió volver a firmar, y el botón para pedirlo (`pedir_refirma_ficha`; nada
 * automático, lo pide una persona). Y la copia firmada en PDF (10c).
 *
 * Sin ninguna firma (un alta validada antes de la ficha firmada, o cerrada sin ella), Dirección puede
 * pedir que se firme (10b-3, decisión del 2026-11-19): a la familia no se le obliga, pero que se le
 * pida es decisión de la directora, no un muro del sistema.
 */
export function FichaFirmadaDireccion({ ninoId, estado, ultima }: Props) {
  const t = useTranslations('alta.firma.direccion')
  const tRoot = useTranslations()
  const format = useFormatter()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const sinFirma = estado !== null && (!estado.firmada || !ultima)
  const pedir = () =>
    start(async () => {
      const r = await pedirRefirmaFichaAction(ninoId)
      if (r.success) toast.success(t(sinFirma ? 'firma_pedida_ok' : 'refirma_pedida_ok'))
      else toast.error(tRoot(r.error))
      setOpen(false)
      router.refresh()
    })

  const fecha = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid',
    })

  return (
    <Card data-testid="ficha-firmada-direccion">
      <CardHeader>
        <CardTitle className="text-base">{t('titulo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {estado === null ? (
          <p className="text-muted-foreground">{t('no_se_pudo_leer')}</p>
        ) : !estado.firmada || !ultima ? (
          <>
            <p className="text-muted-foreground">{t('sin_firma')}</p>
            {estado.refirmaPedida ? (
              <p className="text-accent-warm-800" data-testid="firma-pedida">
                {t('firma_pendiente')}
              </p>
            ) : (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(true)}
                  data-testid="pedir-firma"
                >
                  {t('pedir_firma')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <p>
              {t(ultima.metodo === 'presencial' ? 'firmada_papel' : 'firmada_familia', {
                fecha: fecha(ultima.firmadoAt),
              })}
            </p>
            <p
              className={estado.vigente ? 'text-success-700' : 'text-accent-warm-800'}
              data-testid={estado.vigente ? 'firma-vigente' : 'firma-sin-valor'}
            >
              {estado.vigente
                ? t('vigente')
                : estado.refirmaPedida
                  ? t('refirma_pendiente')
                  : t('sin_valor')}
            </p>
            {/* 10c: la copia de lo que se firmó, valga hoy o no (es la de ese día). */}
            <CopiaFichaFirmada firmaId={ultima.id} />
            {!estado.refirmaPedida && (
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                  {t('pedir_refirma')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(sinFirma ? 'pedir_firma' : 'pedir_refirma')}</DialogTitle>
            <DialogDescription>
              {t(sinFirma ? 'pedir_firma_aviso' : 'pedir_refirma_aviso')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t('cancelar')}
            </Button>
            <Button type="button" onClick={pedir} disabled={pending}>
              {t('pedir_refirma_confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
