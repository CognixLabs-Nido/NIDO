'use client'

import { ImageIcon } from 'lucide-react'
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

import { otorgarImagenNino } from '../actions/otorgar-imagen-nino'

interface Props {
  ninoId: string
  nombreCompleto: string
}

/**
 * Portal de familia — el tutor legal vuelve a autorizar la imagen de su hijo. Las fotos
 * conservadas vuelven a verse; la foto de perfil borrada al revocar no vuelve.
 */
export function AutorizarImagenNinoButton({ ninoId, nombreCompleto }: Props) {
  const t = useTranslations('family.nino.imagen.autorizar')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await otorgarImagenNino({ nino_id: ninoId })
      if (r.success) {
        toast.success(r.data.visible ? t('exito') : t('exito_pendiente'))
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
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="autorizar-imagen-button"
      >
        <ImageIcon />
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
              onClick={confirmar}
              disabled={pending}
              data-testid="autorizar-imagen-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
