'use client'

import { Undo2Icon } from 'lucide-react'
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

import { retirarNoImagenNino } from '../actions/retirar-no-imagen-nino'

interface Props {
  ninoId: string
  nombreCompleto: string
}

/**
 * Portal de familia — el tutor legal retira su «no» a la imagen de su hijo sin decir que sí (fase 10,
 * 10a-2). Queda sin respuesta. El «no» del otro tutor no se toca desde aquí.
 */
export function RetirarNoImagenNinoButton({ ninoId, nombreCompleto }: Props) {
  const t = useTranslations('family.nino.imagen.retirar_no')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await retirarNoImagenNino({ nino_id: ninoId })
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
        data-testid="retirar-no-imagen-button"
      >
        <Undo2Icon />
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
              data-testid="retirar-no-imagen-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
