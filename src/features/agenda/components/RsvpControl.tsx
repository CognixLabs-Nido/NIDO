'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { responderInvitacion } from '../actions/responder-invitacion'
import type { RsvpEstado } from '../types'

interface Props {
  citaId: string
  miEstado: RsvpEstado
  /** La ventana de RSVP sigue abierta (la cita no ha comenzado, AG-11). */
  ventanaAbierta: boolean
  comentarioInicial: string | null
  onChanged: () => void
}

/** Control de RSVP de un invitado interno: aceptar / rechazar + comentario (AG-04). */
export function RsvpControl({
  citaId,
  miEstado,
  ventanaAbierta,
  comentarioInicial,
  onChanged,
}: Props) {
  const t = useTranslations('citas')
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()
  const [comentario, setComentario] = useState(comentarioInicial ?? '')

  function responder(estado: 'aceptado' | 'rechazado') {
    startTransition(async () => {
      const res = await responderInvitacion({
        cita_id: citaId,
        estado,
        comentario: comentario.trim() || null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('toasts.rsvp_guardada'))
      onChanged()
    })
  }

  if (!ventanaAbierta) {
    return <p className="text-muted-foreground text-xs">{t('detalle.ventana_cerrada')}</p>
  }

  return (
    <div className="border-border space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{t('detalle.tu_respuesta')}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={miEstado === 'aceptado' ? 'default' : 'outline'}
          disabled={pending}
          onClick={() => responder('aceptado')}
          data-testid="rsvp-aceptar"
        >
          {t('acciones.aceptar')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={miEstado === 'rechazado' ? 'destructive' : 'outline'}
          disabled={pending}
          onClick={() => responder('rechazado')}
          data-testid="rsvp-rechazar"
        >
          {t('acciones.rechazar')}
        </Button>
      </div>
      <Textarea
        rows={2}
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        placeholder={t('detalle.comentario_placeholder')}
        maxLength={500}
      />
    </div>
  )
}
