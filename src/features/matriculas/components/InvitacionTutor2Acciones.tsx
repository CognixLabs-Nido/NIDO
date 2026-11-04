'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
import {
  cancelarInvitacionTutor2,
  reenviarInvitacionTutor2,
} from '@/features/matriculas/actions/invitacion-tutor2'

interface Props {
  ninoId: string
  /** El email del segundo tutor en su ficha: a él va el reenvío. */
  email: string
  /** Si tiene alguna invitación sin aceptar que cancelar. */
  conInvitacion: boolean
}

/**
 * Los dos botones del segundo tutor en «Altas en proceso» (20261231120000). Reenviar va siempre
 * al email de su ficha; cancelar pide confirmación y deja la ficha, para poder reenviar después.
 */
export function InvitacionTutor2Acciones({ ninoId, email, conInvitacion }: Props) {
  const t = useTranslations('admin.altas.tutor2')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [abierto, setAbierto] = useState(false)

  function reenviar() {
    startTransition(async () => {
      const r = await reenviarInvitacionTutor2(ninoId)
      if (r.success) {
        toast.success(t('reenviada_ok', { email: r.data.email }))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function cancelar() {
    startTransition(async () => {
      const r = await cancelarInvitacionTutor2(ninoId)
      setAbierto(false)
      if (r.success) {
        toast.success(t('cancelada_ok'))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={reenviar}>
          {t('reenviar')}
        </Button>
        {conInvitacion && (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => setAbierto(true)}
          >
            {t('cancelar')}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('reenviar_a', { email })}</p>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmar_titulo')}</DialogTitle>
            <DialogDescription>{t('confirmar_texto')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setAbierto(false)}>
              {t('volver')}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={cancelar}>
              {t('cancelar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
