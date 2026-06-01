'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { cancelarEvento } from '../actions/cancelar-evento'
import { confirmarAsistencia } from '../actions/confirmar-asistencia'
import type { ConfirmacionEstado, EventoDetalle } from '../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  detalle: EventoDetalle | null
  /** admin/profe → ve el roster completo y puede cancelar. */
  esStaff: boolean
  /** tutor/autorizado → confirma/rechaza la asistencia de sus hijos. */
  esFamilia: boolean
  /** Hoy en huso Madrid ('YYYY-MM-DD'), para la ventana de confirmación (D12). */
  hoyYmd: string
  /** Recargar el detalle tras confirmar/cancelar. */
  onChanged: () => void
}

const ESTADO_VARIANT: Record<ConfirmacionEstado, 'success' | 'destructive' | 'outline'> = {
  confirmado: 'success',
  rechazado: 'destructive',
  pendiente: 'outline',
}

export function EventoDetalleDialog({
  open,
  onOpenChange,
  detalle,
  esStaff,
  esFamilia,
  hoyYmd,
  onChanged,
}: Props) {
  const t = useTranslations('eventos')
  const [pending, startTransition] = useTransition()
  const [ninoEnCurso, setNinoEnCurso] = useState<string | null>(null)

  if (!detalle) return null
  const { evento, roster } = detalle
  const cancelado = evento.estado === 'cancelado'
  // Ventana D12: se puede confirmar hasta la fecha (inicio) del evento, inclusive.
  const ventanaAbierta = hoyYmd <= evento.fecha

  function confirmar(ninoId: string, estado: 'confirmado' | 'rechazado') {
    setNinoEnCurso(ninoId)
    startTransition(async () => {
      const res = await confirmarAsistencia({ evento_id: evento.id, nino_id: ninoId, estado })
      setNinoEnCurso(null)
      if (!res.success) {
        toast.error(traducir(res.error))
        return
      }
      toast.success(t('acciones.confirmacion_guardada'))
      onChanged()
    })
  }

  function cancelar() {
    startTransition(async () => {
      const res = await cancelarEvento({ evento_id: evento.id })
      if (!res.success) {
        toast.error(traducir(res.error))
        return
      }
      toast.success(t('acciones.evento_cancelado'))
      onChanged()
      onOpenChange(false)
    })
  }

  function traducir(error: string): string {
    const key = error.replace('eventos.', '')
    // next-intl lanza si la clave no existe; con fallback genérico.
    try {
      return t(key)
    } catch {
      return t('errors.generico')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cancelado ? 'text-muted-foreground line-through' : ''}>
              {evento.titulo}
            </span>
            <Badge variant="secondary">{t(`tipos.${evento.tipo}`)}</Badge>
            {cancelado && <Badge variant="destructive">{t('estados.cancelado')}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {evento.fecha}
            {evento.fecha_fin ? ` – ${evento.fecha_fin}` : ''}
            {evento.hora_inicio ? ` · ${evento.hora_inicio}` : ''}
            {evento.hora_fin ? `–${evento.hora_fin}` : ''}
          </p>
          {evento.lugar && (
            <p>
              <span className="font-medium">{t('detalle.lugar')}:</span> {evento.lugar}
            </p>
          )}
          {evento.descripcion && <p className="whitespace-pre-wrap">{evento.descripcion}</p>}

          {evento.requiere_confirmacion && (
            <div className="border-border space-y-2 rounded-lg border p-3">
              <p className="font-medium">{t('detalle.confirmaciones')}</p>
              {roster.length === 0 && (
                <p className="text-muted-foreground">{t('detalle.sin_ninos')}</p>
              )}
              <ul className="space-y-2" data-testid="evento-roster">
                {roster.map((r) => (
                  <li key={r.nino_id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{r.nino_nombre}</span>
                    <Badge variant={ESTADO_VARIANT[r.estado]}>
                      {t(`estados_confirmacion.${r.estado}`)}
                    </Badge>
                    {esFamilia && !cancelado && ventanaAbierta && (
                      <span className="flex gap-1">
                        <Button
                          type="button"
                          size="xs"
                          variant={r.estado === 'confirmado' ? 'default' : 'outline'}
                          disabled={pending && ninoEnCurso === r.nino_id}
                          onClick={() => confirmar(r.nino_id, 'confirmado')}
                          data-testid={`confirmar-${r.nino_id}`}
                        >
                          {t('acciones.confirmar')}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant={r.estado === 'rechazado' ? 'destructive' : 'outline'}
                          disabled={pending && ninoEnCurso === r.nino_id}
                          onClick={() => confirmar(r.nino_id, 'rechazado')}
                          data-testid={`rechazar-${r.nino_id}`}
                        >
                          {t('acciones.rechazar')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {esFamilia && !cancelado && !ventanaAbierta && (
                <p className="text-muted-foreground text-xs">{t('detalle.ventana_cerrada')}</p>
              )}
            </div>
          )}

          {esStaff && !cancelado && (
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={cancelar}
                data-testid="evento-cancelar"
              >
                {t('acciones.cancelar_evento')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
