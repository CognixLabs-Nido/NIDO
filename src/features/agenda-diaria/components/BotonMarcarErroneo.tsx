'use client'

import { AlertTriangleIcon } from 'lucide-react'
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

import { marcarEventoErroneo } from '../actions/marcar-evento-erroneo'
import type { TablaEvento } from '../schemas/agenda-diaria'

interface Props {
  tabla: TablaEvento
  id: string
}

export function BotonMarcarErroneo({ tabla, id }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await marcarEventoErroneo(tabla, id)
      if (r.success) {
        toast.success(t('guardado'))
        setOpen(false)
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
        data-testid={`anular-${tabla}-${id}`}
      >
        <AlertTriangleIcon />
        {t('anular.boton')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('anular.confirm_title')}</DialogTitle>
            <DialogDescription>{t('anular.confirm_descripcion')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('anular.cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive-strong"
              onClick={confirmar}
              disabled={pending}
            >
              {pending ? t('guardando') : t('anular.confirm_si')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
