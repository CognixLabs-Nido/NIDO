'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { guardarPeticionServicios } from '@/features/peticion-servicios/actions/guardar-peticion-servicios'
import { FilasServicios } from '@/features/peticion-servicios/components/FilasServicios'
import {
  filasServicios,
  respuestasDeValores,
  valoresIniciales,
  type OpcionServicio,
  type RespuestaServicio,
  type Servicio,
} from '@/features/peticion-servicios/lib/peticion'

interface Props {
  locale: string
  ninoId: string
  /** Lo que el centro ofrece y lo ya contestado; `null` si no se pudo leer (no se ofrece guardar). */
  peticion: { opciones: OpcionServicio[]; respuestas: RespuestaServicio[] } | null
  esUltimo: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Fase 8b — el paso de los servicios del alta. Una fila por servicio que el centro tiene en Cuotas,
 * con No / Todos los meses / Días sueltos y el precio del concepto. Contestar cada fila es
 * obligatorio para seguir, y la base lo vuelve a exigir al cerrar (`servicios_por_contestar`). Es
 * una petición: la Dirección la ve al validar y aplica las mensuales desde el mes siguiente al de
 * la incorporación.
 */
export function PasoServicios({ locale, ninoId, peticion, esUltimo, onNext, onBack }: Props) {
  const t = useTranslations('peticion_servicios')
  const tAlta = useTranslations('alta')
  const tErrors = useTranslations()
  const filas = filasServicios(peticion?.opciones ?? [])
  const [valores, setValores] = useState<Partial<Record<Servicio, string>>>(() =>
    valoresIniciales(filas, peticion?.respuestas ?? [])
  )
  const [intentado, setIntentado] = useState(false)
  const [pending, startTransition] = useTransition()

  const completas = filas.every((f) => valores[f.servicio])

  function guardar() {
    setIntentado(true)
    if (!completas) {
      toast.error(t('faltan_filas'))
      return
    }
    startTransition(async () => {
      const r = await guardarPeticionServicios({
        nino_id: ninoId,
        respuestas: respuestasDeValores(filas, valores),
      })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      toast.success(r.data.pendienteValidacion ? t('guardado_cola') : t('guardado'))
      onNext()
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('intro')}</p>
      <p className="text-muted-foreground text-xs">{t('dias_sueltos_aviso')}</p>

      {peticion === null ? (
        <p
          role="alert"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-xl border p-3 text-sm"
        >
          {t('no_leida')}
        </p>
      ) : (
        <FilasServicios
          locale={locale}
          filas={filas}
          valores={valores}
          onChange={(s, v) => setValores((prev) => ({ ...prev, [s]: v }))}
          marcarSinContestar={intentado}
          disabled={pending}
        />
      )}

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {tAlta('wizard.atras')}
        </Button>
        {peticion !== null && (
          <Button type="button" onClick={guardar} disabled={pending}>
            {pending
              ? tAlta('wizard.guardando')
              : esUltimo
                ? tAlta('wizard.finalizar')
                : tAlta('wizard.guardar_siguiente')}
          </Button>
        )}
      </div>
    </div>
  )
}
