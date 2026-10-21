'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** Un botón que pide confirmación antes de una acción de la gestión de Dirección. */
export function ConfirmarDireccionDialog({
  cta,
  titulo,
  texto,
  confirmar,
  destructiva,
  accion,
  alTerminar,
}: {
  cta: string
  titulo: string
  texto: string
  confirmar: string
  destructiva?: boolean
  accion: () => Promise<{ success: true } | { success: false; error: string }>
  /** Tras una acción que sale bien (p. ej. navegar). Sin él, cierra y avisa con `toast`. */
  alTerminar?: () => void
}) {
  const t = useTranslations('admin.direccion')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function ejecutar() {
    startTransition(async () => {
      const r = await accion()
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setOpen(false)
      toast.success(t('hecho'))
      alTerminar?.()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={destructiva ? 'ghost' : 'outline'}
            size="sm"
            className={destructiva ? 'text-destructive' : undefined}
          >
            {cta}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{texto}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancelar')}
          </Button>
          <Button
            type="button"
            variant={destructiva ? 'destructive' : 'default'}
            disabled={pending}
            onClick={ejecutar}
          >
            {confirmar}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
