'use client'

import { useState, useTransition } from 'react'

import { SyringeIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { registrarAdministracion } from '../actions/registrar-administracion'

interface Props {
  autorizacionId: string
  /** Snapshot del tratamiento vigente, para que el staff confirme qué administra. */
  medicamento: string
  dosis: string
}

/**
 * F8-3b (1.er staff): registra una administración de la medicación vigente. Queda
 * PENDIENTE hasta que un 2.º staff distinto la confirme. Notas opcionales; el
 * medicamento/dosis se toman del tratamiento firmado (no se teclean aquí).
 */
export function RegistrarAdministracionDialog({ autorizacionId, medicamento, dosis }: Props) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notas, setNotas] = useState('')
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    startTransition(async () => {
      const res = await registrarAdministracion({
        autorizacion_id: autorizacionId,
        notas: notas.trim() ? notas.trim() : null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('administracion.registrada_toast'))
      setOpen(false)
      setNotas('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <SyringeIcon className="mr-1 size-4" />
            {t('administracion.registrar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('administracion.registrar')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t('administracion.intro')}</p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{t('medicacion.medicamento')}</dt>
              <dd className="font-medium">{medicamento}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs">{t('medicacion.dosis')}</dt>
              <dd className="font-medium">{dosis}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            <Label htmlFor="adm-notas">{t('administracion.notas')}</Label>
            <Textarea
              id="adm-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t('administracion.notas_placeholder')}
            />
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('administracion.aviso_doble')}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('administracion.registrando') : t('administracion.registrar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
