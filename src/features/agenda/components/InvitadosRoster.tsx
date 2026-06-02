'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { agregarInvitados } from '../actions/agregar-invitados'
import { marcarAsistenciaExterno } from '../actions/marcar-asistencia-externo'
import { quitarInvitado } from '../actions/quitar-invitado'
import type { InvitadoInput } from '../schemas/citas'
import type { CitaDetalle, RsvpEstado } from '../types'

import type { ProfeOpt } from './CitaFormDialog'

interface Props {
  detalle: CitaDetalle
  /** Lista de personal para añadir (solo poblada para admin). */
  profes: ProfeOpt[]
  onChanged: () => void
}

const ESTADO_VARIANT: Record<RsvpEstado, 'success' | 'destructive' | 'outline'> = {
  aceptado: 'success',
  rechazado: 'destructive',
  pendiente: 'outline',
}

/**
 * Roster de invitados (solo organizador/admin — roster privado, AG-12). Recuento,
 * estado por invitado, marcar asistencia del externo y editar la lista
 * (añadir/quitar, AG-02). El alta inicial de invitados la hace `CitaFormDialog`.
 */
export function InvitadosRoster({ detalle, profes, onChanged }: Props) {
  const t = useTranslations('citas')
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()
  const [filaEnCurso, setFilaEnCurso] = useState<string | null>(null)
  const [nuevoExterno, setNuevoExterno] = useState('')
  const [staffSel, setStaffSel] = useState('')

  const { cita, roster, recuento } = detalle
  const cancelada = cita.estado === 'cancelada'
  const esVisita = cita.tipo === 'visita'
  // Personal aún no invitado (dedup en el cliente; el action y la UNIQUE también).
  const yaInvitados = new Set(roster.map((r) => r.usuario_id).filter(Boolean))
  const staffDisponible = profes.filter((p) => !yaInvitados.has(p.id))

  function ejecutar(accion: () => Promise<{ success: boolean; error?: string }>, fila: string) {
    setFilaEnCurso(fila)
    startTransition(async () => {
      const res = await accion()
      setFilaEnCurso(null)
      if (!res.success) {
        toast.error(tRoot(res.error ?? 'citas.errors.invitados_fallo'))
        return
      }
      onChanged()
    })
  }

  function marcarExterno(invitadoId: string, estado: 'aceptado' | 'rechazado') {
    ejecutar(async () => {
      const res = await marcarAsistenciaExterno({ invitado_id: invitadoId, estado })
      if (res.success) toast.success(t('toasts.rsvp_guardada'))
      return res
    }, invitadoId)
  }

  function quitar(invitadoId: string) {
    ejecutar(async () => {
      const res = await quitarInvitado({ invitado_id: invitadoId })
      if (res.success) toast.success(t('toasts.invitado_quitado'))
      return res
    }, invitadoId)
  }

  function anadir(invitado: InvitadoInput, limpiar: () => void) {
    ejecutar(async () => {
      const res = await agregarInvitados({ cita_id: cita.id, invitados: [invitado] })
      if (res.success) {
        toast.success(t('toasts.invitados_anadidos'))
        limpiar()
      }
      return res
    }, 'anadir')
  }

  return (
    <div className="border-border space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('detalle.invitados')}</p>
        <p className="text-muted-foreground text-xs">
          {t('roster.recuento', {
            aceptado: recuento.aceptado,
            rechazado: recuento.rechazado,
            pendiente: recuento.pendiente,
          })}
        </p>
      </div>

      {roster.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('detalle.sin_invitados')}</p>
      ) : (
        <ul className="space-y-2" data-testid="cita-roster">
          {roster.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {r.nombre}
                {r.es_externo && (
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({t('roster.externo')})
                  </span>
                )}
              </span>
              <Badge variant={ESTADO_VARIANT[r.estado]}>{t(`rsvp.${r.estado}`)}</Badge>
              {!cancelada && r.es_externo && (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={r.estado === 'aceptado' ? 'default' : 'outline'}
                    disabled={pending && filaEnCurso === r.id}
                    onClick={() => marcarExterno(r.id, 'aceptado')}
                  >
                    {t('acciones.marcar_asistio')}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={r.estado === 'rechazado' ? 'destructive' : 'outline'}
                    disabled={pending && filaEnCurso === r.id}
                    onClick={() => marcarExterno(r.id, 'rechazado')}
                  >
                    {t('acciones.marcar_no_asistio')}
                  </Button>
                </span>
              )}
              {!cancelada && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={pending && filaEnCurso === r.id}
                  onClick={() => quitar(r.id)}
                  aria-label={t('acciones.quitar')}
                >
                  ✕
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!cancelada && (esVisita || staffDisponible.length > 0) && (
        <div className="border-border space-y-2 border-t pt-3">
          {staffDisponible.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  items={staffDisponible.map((p) => ({ value: p.id, label: p.nombre }))}
                  value={staffSel}
                  onValueChange={(v) => setStaffSel(v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('acciones.anadir_staff')} />
                  </SelectTrigger>
                  <SelectContent>
                    {staffDisponible.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!staffSel || (pending && filaEnCurso === 'anadir')}
                onClick={() =>
                  anadir({ tipo: 'usuario', usuario_id: staffSel }, () => setStaffSel(''))
                }
              >
                {t('acciones.anadir')}
              </Button>
            </div>
          )}

          {esVisita && (
            <div className="flex items-end gap-2">
              <Input
                className="flex-1"
                value={nuevoExterno}
                onChange={(e) => setNuevoExterno(e.target.value)}
                placeholder={t('acciones.anadir_externo')}
                maxLength={200}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!nuevoExterno.trim() || (pending && filaEnCurso === 'anadir')}
                onClick={() =>
                  anadir({ tipo: 'externo', nombre_externo: nuevoExterno.trim() }, () =>
                    setNuevoExterno('')
                  )
                }
              >
                {t('acciones.anadir')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
