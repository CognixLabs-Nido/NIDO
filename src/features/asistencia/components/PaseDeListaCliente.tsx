'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { AgendaDayPicker } from '@/features/agenda-diaria/components/AgendaDayPicker'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { PaseDeListaTable } from '@/shared/components/pase-de-lista/PaseDeListaTable'
import type {
  PaseDeListaColumn,
  PaseDeListaItem,
  PaseDeListaQuickAction,
} from '@/shared/components/pase-de-lista/types'

import { batchUpsertAsistencias } from '../actions/batch-upsert-asistencias'
import type { EstadoAsistencia } from '../schemas/asistencia'
import type { NinoAsistenciaResumen } from '../types'

import { useAsistenciaRealtime } from './use-asistencia-realtime'

// Tipo compatible con `Record<string, unknown>` (constraint del componente
// genérico) usando una intersección. Cada celda mantiene su tipo concreto.
type PaseDeListaValue = {
  estado: EstadoAsistencia | ''
  hora_llegada: string | null
  hora_salida: string | null
  observaciones: string | null
} & Record<string, unknown>

interface Props {
  aulaId: string
  locale: string
  fecha: string
  filas: NinoAsistenciaResumen[]
}

export function PaseDeListaCliente({ aulaId, locale, fecha, filas }: Props) {
  const t = useTranslations('asistencia')
  const router = useRouter()
  const hoy = hoyMadrid()
  const diaCerrado = fecha !== hoy

  function setFecha(nueva: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', nueva)
    router.push(url.pathname + url.search)
  }

  const ninoIds = useMemo(() => filas.map((f) => f.nino.id), [filas])

  const onRealtimeChange = useCallback(() => {
    router.refresh()
  }, [router])

  useAsistenciaRealtime({
    channel: `asistencia-aula-${aulaId}`,
    ninoIds,
    enabled: true,
    onChange: onRealtimeChange,
  })

  const items: PaseDeListaItem<NinoAsistenciaResumen['nino'], PaseDeListaValue>[] = filas.map(
    (f) => {
      // Auto-link: si hay ausencia activa, pre-rellenamos como `ausente` y
      // pintamos badge. La profe puede sobrescribir si el niño aparece.
      const initial: PaseDeListaValue | null = f.asistencia
        ? {
            estado: f.asistencia.estado,
            hora_llegada: f.asistencia.hora_llegada,
            hora_salida: f.asistencia.hora_salida,
            observaciones: f.asistencia.observaciones,
          }
        : f.ausencia
          ? {
              estado: 'ausente',
              hora_llegada: null,
              hora_salida: null,
              observaciones: null,
            }
          : null

      const badges: Array<{
        label: string
        variant?: 'warm' | 'info' | 'destructive' | 'secondary'
      }> = []
      if (f.ausencia) {
        badges.push({
          label: t('badge.ausencia_reportada'),
          variant: 'info',
        })
      }
      if (f.alertas.alergia_grave) {
        badges.push({ label: t('alertas.alergia_grave'), variant: 'destructive' })
      }
      if (f.alertas.medicacion) {
        badges.push({ label: t('alertas.medicacion'), variant: 'warm' })
      }

      return {
        id: f.nino.id,
        item: f.nino,
        initial,
        badges,
      }
    }
  )

  const columns: PaseDeListaColumn<PaseDeListaValue>[] = [
    {
      id: 'estado',
      label: t('columna.estado'),
      type: 'radio',
      width: '320px',
      options: [
        { value: 'presente', label: t('estado_opciones.presente') },
        { value: 'ausente', label: t('estado_opciones.ausente') },
        { value: 'llegada_tarde', label: t('estado_opciones.llegada_tarde') },
        { value: 'salida_temprana', label: t('estado_opciones.salida_temprana') },
      ],
    },
    {
      id: 'hora_llegada',
      label: t('columna.hora_llegada'),
      type: 'time',
      width: '110px',
      visibleWhen: (v) => v.estado !== 'ausente' && v.estado !== '',
    },
    {
      id: 'hora_salida',
      label: t('columna.hora_salida'),
      type: 'time',
      width: '110px',
      visibleWhen: (v) => v.estado === 'salida_temprana',
    },
    {
      id: 'observaciones',
      label: t('columna.observaciones'),
      type: 'text-short',
      width: '200px',
      placeholder: t('placeholder_observaciones'),
    },
  ]

  const quickActions: PaseDeListaQuickAction<PaseDeListaValue>[] = [
    {
      id: 'todos-presentes',
      label: t('quick_actions.todos_presentes'),
      apply: (current) => ({
        estado: 'presente',
        hora_llegada: current.hora_llegada ?? '09:00',
      }),
      onlyClean: true,
    },
  ]

  async function onBatchSubmit(
    rows: Array<{ id: string; item: NinoAsistenciaResumen['nino']; value: PaseDeListaValue }>
  ): Promise<{ success: boolean; error?: string }> {
    const result = await batchUpsertAsistencias({
      fecha,
      items: rows.map((r) => ({
        nino_id: r.id,
        asistencia: {
          estado: r.value.estado as EstadoAsistencia,
          hora_llegada: r.value.hora_llegada ?? null,
          hora_salida: r.value.hora_salida ?? null,
          observaciones: r.value.observaciones ?? null,
        },
      })),
    })
    if (result.success) {
      router.refresh()
      return { success: true }
    }
    return { success: false, error: result.error }
  }

  return (
    <div className="space-y-4">
      <AgendaDayPicker
        fecha={fecha}
        locale={locale}
        onChange={setFecha}
        diaCerrado={diaCerrado}
        hoy={hoy}
      />

      {filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('ningun_nino')}</p>
      ) : (
        <PaseDeListaTable
          items={items}
          renderItem={(nino) => (
            <span className="text-foreground text-sm font-medium">
              {nino.nombre} {nino.apellidos}
            </span>
          )}
          columns={columns}
          quickActions={quickActions}
          onBatchSubmit={onBatchSubmit}
          readOnly={diaCerrado}
          submitLabel={t('guardar')}
          i18n={{
            pending: t('status.pending'),
            dirty: t('status.dirty'),
            saved: t('status.saved'),
            errorRow: t('status.error'),
          }}
          renderRowExtra={(_, value) =>
            value.estado === 'ausente' ? (
              <Badge variant="info" data-testid="row-badge-ausente">
                {t('estado_opciones.ausente')}
              </Badge>
            ) : null
          }
        />
      )}
    </div>
  )
}
