'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
  DialogTrigger,
} from '@/components/ui/dialog'

import { promoverATitular } from '../actions/promover-a-titular'

/**
 * Cierre de la purga RGPD — la directora pasa al segundo tutor a titular cuando la familia se
 * ha quedado sin titular (la purga no lo hace sola).
 */
export function PromoverTitularDialog({
  tutorId,
  nombre,
  trigger,
}: {
  tutorId: string
  nombre: string
  trigger: ReactElement
}) {
  const t = useTranslations('admin.familias.promover')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await promoverATitular({ tutor_id: tutorId })
      if (r.success) {
        toast.success(t('hecho'))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('titulo')}</DialogTitle>
          <DialogDescription>{t('descripcion', { nombre })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancelar')}
          </Button>
          <Button onClick={confirmar} disabled={pending}>
            {t('confirmar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
