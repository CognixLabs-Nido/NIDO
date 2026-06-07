'use client'

import { ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { MedicacionDatos } from '../types'

interface Props {
  medicacion: MedicacionDatos | null
  /** ¿El hash de la última firma cuadra con texto + datos? `null` = sin firma aún. */
  integridadOk?: boolean | null
}

/** Hoy en huso Madrid como YYYY-MM-DD (para el estado de vigencia efectiva). */
function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

/**
 * Ficha de la medicación vigente (de la última firma `firmado`) + indicador de
 * integridad del hash. Solo lectura; la usan los detalles admin (profe/dirección
 * la administran) y familia.
 */
export function MedicacionFicha({ medicacion, integridadOk }: Props) {
  const t = useTranslations('autorizaciones')

  // Vigencia EFECTIVA del tratamiento (≠ vigencia de firma): hoy ∈ [inicio, fin].
  let estado: 'vigente' | 'futura' | 'finalizada' | null = null
  if (medicacion) {
    const hoy = hoyMadrid()
    estado =
      hoy < medicacion.fecha_inicio
        ? 'futura'
        : hoy > medicacion.fecha_fin
          ? 'finalizada'
          : 'vigente'
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h3">{t('medicacion.ficha')}</h2>
        {estado === 'vigente' && (
          <span className="text-success-700 bg-success-50 rounded-full px-2 py-0.5 text-xs">
            {t('medicacion.estado_vigente')}
          </span>
        )}
        {estado === 'futura' && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {t('medicacion.estado_futura', { fecha: medicacion!.fecha_inicio })}
          </span>
        )}
        {estado === 'finalizada' && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {t('medicacion.estado_finalizada')}
          </span>
        )}
        {integridadOk === true && (
          <span className="text-success-700 inline-flex items-center gap-1 text-xs">
            <ShieldCheckIcon className="size-3.5" />
            {t('recogida.integra')}
          </span>
        )}
        {integridadOk === false && (
          <span className="text-coral-700 inline-flex items-center gap-1 text-xs">
            <ShieldAlertIcon className="size-3.5" />
            {t('recogida.no_integra')}
          </span>
        )}
      </div>

      {!medicacion ? (
        <p className="text-muted-foreground text-sm">{t('recogida.sin_firmar')}</p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
          <Campo label={t('medicacion.medicamento')} value={medicacion.medicamento} />
          <Campo label={t('medicacion.dosis')} value={medicacion.dosis} />
          {medicacion.via && <Campo label={t('medicacion.via')} value={medicacion.via} />}
          <Campo label={t('medicacion.pauta')} value={medicacion.pauta} />
          <Campo label={t('medicacion.fecha_inicio')} value={medicacion.fecha_inicio} />
          <Campo label={t('medicacion.fecha_fin')} value={medicacion.fecha_fin} />
        </dl>
      )}
    </div>
  )
}

function Campo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
