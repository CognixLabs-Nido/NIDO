'use client'

import { CheckCircle2Icon, ClockIcon, LogOutIcon, MinusCircleIcon, XCircleIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

import type { ModoFecha } from '@/shared/components/day-picker/modo-fecha'

import type { MotivoAusencia } from '../../ausencias/schemas/ausencia'
import type { EstadoAsistencia } from '../schemas/asistencia'
import type { NinoAsistenciaResumen } from '../types'

/**
 * Vista read-only del pase de lista con badges visuales prominentes. Cada
 * fila lleva un badge con color + icono + hora (si aplica) según el estado
 * registrado. En modo `futuro`, los presentes/llegada_tarde/salida_temprana
 * no tienen sentido todavía — solo se renderizan las ausencias ya
 * reportadas; el resto muestra "Sin registrar".
 *
 * Colores siguen el design system (ADR-0008):
 *  - success (verde): presente
 *  - destructive (coral): ausente
 *  - warm (ámbar):    llegada_tarde
 *  - info (azul):     salida_temprana
 *  - outline (gris):  sin_registrar
 */
interface Props {
  filas: NinoAsistenciaResumen[]
  modo: ModoFecha
}

type BadgeVariant = 'success' | 'info' | 'warm' | 'destructive' | 'outline'

interface BadgeDef {
  variant: BadgeVariant
  icon: LucideIcon
}

const BADGES: Record<EstadoAsistencia, BadgeDef> = {
  presente: { variant: 'success', icon: CheckCircle2Icon },
  ausente: { variant: 'destructive', icon: XCircleIcon },
  llegada_tarde: { variant: 'warm', icon: ClockIcon },
  salida_temprana: { variant: 'info', icon: LogOutIcon },
}

export function AsistenciaReadOnlyList({ filas, modo }: Props) {
  const t = useTranslations('asistencia')

  if (modo === 'futuro') {
    return (
      <div className="space-y-3">
        <div className="border-info-200 bg-info-50 rounded-2xl border p-4 text-sm">
          <p className="text-info-700 font-semibold">{t('vista.preview_futuro_titulo')}</p>
          <p className="text-info-700/80">{t('vista.preview_futuro_desc')}</p>
        </div>
        <ul className="space-y-2" aria-label={t('title')}>
          {filas.map((f) => (
            <FilaReadOnly key={f.nino.id} fila={f} modo={modo} />
          ))}
        </ul>
      </div>
    )
  }

  // modo === 'historico'
  const algunRegistrado = filas.some((f) => f.asistencia !== null)
  return (
    <div className="space-y-3">
      {!algunRegistrado && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<MinusCircleIcon strokeWidth={1.75} />}
              title={t('vista.sin_pase_de_lista')}
            />
          </CardContent>
        </Card>
      )}
      <ul className="space-y-2" aria-label={t('title')}>
        {filas.map((f) => (
          <FilaReadOnly key={f.nino.id} fila={f} modo={modo} />
        ))}
      </ul>
    </div>
  )
}

function FilaReadOnly({ fila, modo }: { fila: NinoAsistenciaResumen; modo: ModoFecha }) {
  const t = useTranslations('asistencia')
  const tAusencia = useTranslations('ausencia')
  const a = fila.asistencia
  const au = fila.ausencia

  const mostrarAsistencia = modo === 'historico' && a !== null
  const mostrarAusenciaSola = !mostrarAsistencia && au !== null
  const sinRegistro = !mostrarAsistencia && !mostrarAusenciaSola

  return (
    <Card data-testid={`fila-readonly-${fila.nino.id}`}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-foreground font-medium">
            {fila.nino.nombre} {fila.nino.apellidos}
          </span>
          {fila.alertas.alergia_grave && (
            <Badge variant="destructive">{t('alertas.alergia_grave')}</Badge>
          )}
          {fila.alertas.medicacion && <Badge variant="warm">{t('alertas.medicacion')}</Badge>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {mostrarAsistencia && a && (
            <EstadoBadge
              estado={a.estado}
              horaLlegada={a.hora_llegada}
              horaSalida={a.hora_salida}
            />
          )}
          {mostrarAusenciaSola && au && (
            <Badge
              variant="destructive"
              data-testid={`badge-ausencia-${fila.nino.id}`}
              title={au.descripcion ?? undefined}
            >
              <XCircleIcon className="size-3.5" />
              {t('estado_opciones.ausente')}
              <span className="text-foreground/60 ml-1">
                · {labelDeMotivo(tAusencia, au.motivo)}
              </span>
            </Badge>
          )}
          {sinRegistro && (
            <Badge variant="outline" data-testid={`badge-sin-registro-${fila.nino.id}`}>
              <MinusCircleIcon className="size-3.5" />
              {t('vista.sin_registrar')}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function EstadoBadge({
  estado,
  horaLlegada,
  horaSalida,
}: {
  estado: EstadoAsistencia
  horaLlegada: string | null
  horaSalida: string | null
}) {
  const t = useTranslations('asistencia')
  const def = BADGES[estado]
  const Icon = def.icon
  const hora = estado === 'salida_temprana' ? horaSalida : horaLlegada
  const label = labelDeEstado(t, estado)
  return (
    <Badge variant={def.variant} data-testid={`badge-estado-${estado}`}>
      <Icon className="size-3.5" />
      {label}
      {hora && (
        <span className="text-foreground/60 ml-1">· {t('vista.registrado_a_las', { hora })}</span>
      )}
    </Badge>
  )
}

function labelDeEstado(
  t: ReturnType<typeof useTranslations<'asistencia'>>,
  estado: EstadoAsistencia
): string {
  switch (estado) {
    case 'presente':
      return t('estado_opciones.presente')
    case 'ausente':
      return t('estado_opciones.ausente')
    case 'llegada_tarde':
      return t('estado_opciones.llegada_tarde')
    case 'salida_temprana':
      return t('estado_opciones.salida_temprana')
  }
}

function labelDeMotivo(
  t: ReturnType<typeof useTranslations<'ausencia'>>,
  motivo: MotivoAusencia
): string {
  switch (motivo) {
    case 'enfermedad':
      return t('motivo_opciones.enfermedad')
    case 'cita_medica':
      return t('motivo_opciones.cita_medica')
    case 'vacaciones':
      return t('motivo_opciones.vacaciones')
    case 'familiar':
      return t('motivo_opciones.familiar')
    case 'otro':
      return t('motivo_opciones.otro')
  }
}
