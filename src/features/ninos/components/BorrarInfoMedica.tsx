'use client'

import { Trash2Icon } from 'lucide-react'
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

import { borrarInfoMedicaTutor } from '../actions/borrar-info-medica-tutor'

interface Props {
  ninoId: string
}

/**
 * Flag-2 (F11-F2) — botón para que el tutor LEGAL retire la info médica voluntaria
 * de su hijo. Confirmación destructiva honesta ("no se puede deshacer"); al borrar
 * refresca el server component → la sección médica queda vacía.
 */
export function BorrarInfoMedica({ ninoId }: Props) {
  const t = useTranslations('family.nino.borrar_medica')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await borrarInfoMedicaTutor(ninoId)
      if (r.success) {
        toast.success(t('borrado'))
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
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        data-testid="borrar-info-medica-button"
      >
        <Trash2Icon />
        {t('boton')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirm_title')}</DialogTitle>
            <DialogDescription>{t('confirm_descripcion')}</DialogDescription>
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
              data-testid="borrar-info-medica-confirm"
            >
              {pending ? t('borrando') : t('confirm_si')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
