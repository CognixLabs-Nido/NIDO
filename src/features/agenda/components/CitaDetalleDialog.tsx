'use client'

import { useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { cancelarCita } from '../actions/cancelar-cita'
import { citaYaComenzo } from '../lib/fechas'
import type { CitaDetalle } from '../types'

import type { ProfeOpt } from './CitaFormDialog'
import { InvitadosRoster } from './InvitadosRoster'
import { RsvpControl } from './RsvpControl'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  detalle: CitaDetalle | null
  /** admin del centro → gestiona cualquier cita (roster, cancelar), aunque no la organice. */
  esAdmin: boolean
  /** Personal para añadir invitados desde el roster (solo poblado para admin). */
  profes: ProfeOpt[]
  /** Recargar el detalle + la vista tras responder/gestionar. */
  onChanged: () => void
}

/**
 * Detalle de una cita: info + (invitado) control RSVP + (organizador/admin) roster
 * con edición de la lista y cancelación. El roster privado lo enforza la RLS: un
 * invitado solo recibe su propia fila (AG-12).
 */
export function CitaDetalleDialog({
  open,
  onOpenChange,
  detalle,
  esAdmin,
  profes,
  onChanged,
}: Props) {
  const t = useTranslations('citas')
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()

  if (!detalle) return null
  const { cita } = detalle
  const cancelada = cita.estado === 'cancelada'
  const puedeGestionar = (cita.es_organizador || esAdmin) && !cancelada
  const soyInvitado = cita.mi_estado !== null
  const ventanaAbierta = !citaYaComenzo(cita.fecha, cita.hora_inicio)
  // Un invitado recibe por RLS solo su propia fila (roster privado): prefijamos su
  // comentario desde ella. (Un admin invitado vería la lista completa — sin prefill.)
  const miComentario =
    soyInvitado && detalle.roster.length === 1 ? detalle.roster[0].comentario : null

  function cancelar() {
    startTransition(async () => {
      const res = await cancelarCita({ cita_id: cita.id })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('toasts.cita_cancelada'))
      onChanged()
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className={cancelada ? 'text-muted-foreground line-through' : ''}>
              {cita.titulo}
            </span>
            <Badge variant="secondary">{t(`tipos.${cita.tipo}`)}</Badge>
            {cancelada && <Badge variant="destructive">{t('detalle.cancelada')}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {cita.fecha} · {cita.hora_inicio.slice(0, 5)}
            {cita.hora_fin ? `–${cita.hora_fin.slice(0, 5)}` : ''}
          </p>
          {cita.lugar && (
            <p>
              <span className="font-medium">{t('detalle.lugar')}:</span> {cita.lugar}
            </p>
          )}
          {cita.descripcion && <p className="whitespace-pre-wrap">{cita.descripcion}</p>}

          {soyInvitado && !cancelada && (
            <RsvpControl
              citaId={cita.id}
              miEstado={cita.mi_estado!}
              ventanaAbierta={ventanaAbierta}
              comentarioInicial={miComentario}
              onChanged={onChanged}
            />
          )}

          {(cita.es_organizador || esAdmin) && (
            <InvitadosRoster detalle={detalle} profes={profes} onChanged={onChanged} />
          )}

          {puedeGestionar && (
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={cancelar}
                data-testid="cita-cancelar"
              >
                {t('acciones.cancelar_cita')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
