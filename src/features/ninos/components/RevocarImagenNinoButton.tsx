'use client'

import { ImageOffIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { revocarImagenNino } from '../actions/revocar-imagen-nino'

interface Props {
  ninoId: string
  nombreCompleto: string
}

/**
 * IU-4 — botón de Dirección para revocar el consentimiento de imagen de un niño.
 * Revocar OCULTA al instante al niño de todas las publicaciones donde aparece y
 * ELIMINA su foto de perfil. No borra las fotos de las publicaciones (Dirección las
 * resuelve a mano en IU-5). Por-niño: no afecta a los hermanos.
 */
export function RevocarImagenNinoButton({ ninoId, nombreCompleto }: Props) {
  const t = useTranslations('admin.ninos.fotos.revocar')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await revocarImagenNino({ nino_id: ninoId })
      if (r.success) {
        toast.success(t('exito'))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="revocar-imagen-button"
      >
        <ImageOffIcon />
        {t('boton')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titulo')}</DialogTitle>
            <DialogDescription>{t('aviso', { nombre: nombreCompleto })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive-strong"
              onClick={confirmar}
              disabled={pending}
              data-testid="revocar-imagen-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
