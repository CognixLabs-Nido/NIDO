'use client'

import { PhoneIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { telefonosFamilia, type TelefonoFamilia } from '../actions/telefonos-familia'

/**
 * Fase 6: «Llamar a la familia», junto a «Escribir a la familia» en la tarjeta del niño del aula. Al
 * pulsar lee los teléfonos (no antes) y los enseña como enlaces que llaman con un toque. Si no se
 * pueden leer, lo dice: una lista vacía parecería «no tiene teléfono».
 */
export function LlamarFamiliaButton({ ninoId }: { ninoId: string }) {
  const t = useTranslations('familias.llamar')
  const tErr = useTranslations()
  const [abierto, setAbierto] = useState(false)
  const [telefonos, setTelefonos] = useState<TelefonoFamilia[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function abrir() {
    setAbierto(true)
    setTelefonos(null)
    setError(null)
    startTransition(async () => {
      const r = await telefonosFamilia(ninoId)
      if (r.success) setTelefonos(r.data)
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
        data-testid="llamar-familia-button"
      >
        <PhoneIcon className="size-4" />
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
            <p role="alert" className="text-destructive text-sm" data-testid="llamar-familia-error">
              {tErr(error)}
            </p>
          )}
          {telefonos && telefonos.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('sin_tutores')}</p>
          )}
          {telefonos && telefonos.length > 0 && (
            <ul className="space-y-2">
              {telefonos.map((tel) => (
                <li key={tel.rol} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{tel.nombre ?? t(`rol.${tel.rol}`)}</span>
                    <span className="text-muted-foreground"> · {t(`rol.${tel.rol}`)}</span>
                  </span>
                  {tel.telefono ? (
                    <a
                      href={`tel:${tel.telefono}`}
                      className="text-primary inline-flex items-center gap-1 font-medium underline"
                    >
                      <PhoneIcon className="size-4" aria-hidden />
                      {tel.telefono}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{t('sin_telefono')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
