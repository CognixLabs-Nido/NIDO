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

import { denegarImagenNino } from '../actions/denegar-imagen-nino'

interface Props {
  ninoId: string
  nombreCompleto: string
}

/**
 * Portal de familia — el tutor legal dice que no autoriza la imagen de su hijo (fase 10, 10a-2). Es
 * su respuesta, no la del otro tutor, y con ella el niño no aparece en las fotos aunque el otro diga
 * que sí (decisión del responsable del 2026-11-17).
 */
export function DenegarImagenNinoButton({ ninoId, nombreCompleto }: Props) {
  const t = useTranslations('family.nino.imagen.denegar')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await denegarImagenNino({ nino_id: ninoId })
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
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="denegar-imagen-button"
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
              onClick={confirmar}
              disabled={pending}
              data-testid="denegar-imagen-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
