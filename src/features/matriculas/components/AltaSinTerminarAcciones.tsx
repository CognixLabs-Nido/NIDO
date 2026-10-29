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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { anularAlta, reinvitarAlta } from '@/features/matriculas/actions/alta-sin-terminar'

interface Props {
  ninoId: string
  estado: 'invitacion_abierta' | 'sin_invitacion' | 'iniciada'
  email: string | null
  familiaNueva: boolean
  locale: string
}

/**
 * El botón del alta sin terminar (Dirección), con su efecto según el estado: con la invitación
 * abierta la cancela; si no, borra el alta. Y, con el alta sin empezar, «Enviar una invitación
 * nueva» con el email corregido.
 */
export function AltaSinTerminarAcciones({ ninoId, estado, email, familiaNueva, locale }: Props) {
  const t = useTranslations('admin.ninos.sin_terminar')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [nuevoEmail, setNuevoEmail] = useState(email ?? '')

  const accion = estado === 'invitacion_abierta' ? 'cancelar' : 'borrar'
  const efecto =
    accion === 'cancelar' ? 'cancelar' : familiaNueva ? 'borrar_familia' : 'borrar_solo_alta'

  function confirmar() {
    startTransition(async () => {
      const r = await anularAlta(ninoId)
      setAbierto(false)
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      if (r.data.resultado === 'borrada') {
        toast.success(t('borrada_ok'))
        router.push(`/${locale}/admin/ninos`)
      } else {
        toast.success(t('cancelada_ok'))
        router.refresh()
      }
    })
  }

  function reinvitar() {
    startTransition(async () => {
      const r = await reinvitarAlta({ ninoId, email: nuevoEmail })
      if (r.success) {
        toast.success(t('reinvitada_ok', { email: r.data.email }))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-3">
      {estado !== 'iniciada' && (
        <div className="space-y-1.5">
          <Label htmlFor={`reinvitar-${ninoId}`}>{t('reinvitar_label')}</Label>
          <div className="flex gap-2">
            <Input
              id={`reinvitar-${ninoId}`}
              type="email"
              value={nuevoEmail}
              onChange={(e) => setNuevoEmail(e.target.value)}
              disabled={pending}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || nuevoEmail.trim() === ''}
              onClick={reinvitar}
            >
              {t('reinvitar')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t('reinvitar_ayuda')}</p>
        </div>
      )}
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => setAbierto(true)}>
        {t(`boton.${efecto}`)}
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(`confirmar.${efecto}.titulo`)}</DialogTitle>
            <DialogDescription>{t(`confirmar.${efecto}.texto`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setAbierto(false)}>
              {t('confirmar.volver')}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={confirmar}>
              {t(`boton.${efecto}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
