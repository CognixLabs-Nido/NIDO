'use client'

import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@/components/ui/card'

import type { ModoFecha } from '../lib/modo-fecha'
import type { NinoAsistenciaResumen } from '../types'

/**
 * Vista read-only del pase de lista para días no editables (ayer y antes,
 * mañana y adelante). Versión inicial: muestra el nombre del niño y el
 * estado en texto plano. La presentación visual con badges/colores llega
 * en un commit posterior.
 */
interface Props {
  filas: NinoAsistenciaResumen[]
  modo: ModoFecha
}

export function AsistenciaReadOnlyList({ filas, modo }: Props) {
  const t = useTranslations('asistencia')
  const tAusencia = useTranslations('ausencia')

  return (
    <div className="space-y-3">
      {modo === 'futuro' && (
        <div className="border-info-200 bg-info-50 rounded-2xl border p-4 text-sm">
          <p className="text-info-700 font-semibold">{t('vista.preview_futuro_titulo')}</p>
          <p className="text-info-700/80">{t('vista.preview_futuro_desc')}</p>
        </div>
      )}
      <ul className="space-y-2" aria-label={t('title')}>
        {filas.map((f) => {
          const a = f.asistencia
          const au = f.ausencia
          const texto = textoEstado(t, tAusencia, modo, a, au)
          return (
            <li key={f.nino.id}>
              <Card data-testid={`fila-readonly-${f.nino.id}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-foreground font-medium">
                    {f.nino.nombre} {f.nino.apellidos}
                  </span>
                  <span className="text-muted-foreground">{texto}</span>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function textoEstado(
  t: ReturnType<typeof useTranslations<'asistencia'>>,
  tAusencia: ReturnType<typeof useTranslations<'ausencia'>>,
  modo: ModoFecha,
  a: NinoAsistenciaResumen['asistencia'],
  au: NinoAsistenciaResumen['ausencia']
): string {
  if (modo === 'historico' && a) {
    switch (a.estado) {
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
  if (au) {
    switch (au.motivo) {
      case 'enfermedad':
        return `${t('estado_opciones.ausente')} · ${tAusencia('motivo_opciones.enfermedad')}`
      case 'cita_medica':
        return `${t('estado_opciones.ausente')} · ${tAusencia('motivo_opciones.cita_medica')}`
      case 'vacaciones':
        return `${t('estado_opciones.ausente')} · ${tAusencia('motivo_opciones.vacaciones')}`
      case 'familiar':
        return `${t('estado_opciones.ausente')} · ${tAusencia('motivo_opciones.familiar')}`
      case 'otro':
        return `${t('estado_opciones.ausente')} · ${tAusencia('motivo_opciones.otro')}`
    }
  }
  return t('vista.sin_registrar')
}
