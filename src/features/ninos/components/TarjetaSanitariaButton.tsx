'use client'

import { IdCardIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { numeroTarjetaSanitaria } from '../actions/tarjeta-sanitaria'

/**
 * Fase 7: «Tarjeta sanitaria», junto a «Llamar a la familia» en la tarjeta del niño del aula. Al
 * pulsar lee el número (no antes) y lo enseña grande, para dictarlo en el centro de salud. Si no se
 * puede leer, lo dice: un hueco parecería «no tiene tarjeta».
 */
export function TarjetaSanitariaButton({ ninoId }: { ninoId: string }) {
  const t = useTranslations('nino.tarjeta_sanitaria')
  const tErr = useTranslations()
  const [abierto, setAbierto] = useState(false)
  const [sip, setSip] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function abrir() {
    setAbierto(true)
    setSip(undefined)
    setError(null)
    startTransition(async () => {
      const r = await numeroTarjetaSanitaria(ninoId)
      if (r.success) setSip(r.data.sip)
      else setError(r.error)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="border-border text-muted-foreground hover:bg-muted hover:text-foreground flex shrink-0 items-center gap-1 border-l px-3 text-xs font-medium transition-colors"
        aria-label={t('boton')}
        data-testid="tarjeta-sanitaria-button"
      >
        <IdCardIcon className="size-4" />
        <span className="hidden sm:inline">{t('boton')}</span>
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titulo')}</DialogTitle>
            <DialogDescription>{t('descripcion')}</DialogDescription>
          </DialogHeader>
          {pending && <p className="text-muted-foreground text-sm">{t('cargando')}</p>}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {tErr(error)}
            </p>
          )}
          {sip !== undefined &&
            (sip ? (
              <p
                className="text-2xl font-semibold tracking-wider"
                data-testid="tarjeta-sanitaria-dialogo"
              >
                {sip}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">{t('sin_numero')}</p>
            ))}
        </DialogContent>
      </Dialog>
    </>
  )
}
