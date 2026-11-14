'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { guardarPeticionServicios } from '../actions/guardar-peticion-servicios'
import {
  filasServicios,
  respuestasDeValores,
  respuestasQueCambian,
  sinContestar,
  valoresIniciales,
  type OpcionServicio,
  type RespuestaServicio,
  type Servicio,
} from '../lib/peticion'
import { FilasServicios } from './FilasServicios'

interface Props {
  locale: string
  ninoId: string
  opciones: OpcionServicio[]
  respuestas: RespuestaServicio[]
}

/**
 * Fase 8b — la petición de servicios en la tarjeta de validación de Dirección. La ve, y la puede
 * corregir antes de validar (`guardar_peticion_servicios`, auditada a su nombre). Lo que falta por
 * contestar la avisa y no le bloquea la validación (decidido el 2026-11-14, como los documentos en
 * P-6). Validar aplica las mensuales desde el día 1 del mes siguiente al de la incorporación.
 */
export function PeticionServiciosDireccion({ locale, ninoId, opciones, respuestas }: Props) {
  const t = useTranslations('peticion_servicios')
  const tErrors = useTranslations()
  const router = useRouter()
  const filas = filasServicios(opciones)
  const [valores, setValores] = useState<Partial<Record<Servicio, string>>>(() =>
    valoresIniciales(filas, respuestas)
  )
  const [pending, startTransition] = useTransition()

  const faltan = sinContestar(filas, respuestas)
  const nuevas = respuestasDeValores(filas, valores)
  const cambia = respuestasQueCambian(respuestas, nuevas).length > 0

  function guardar() {
    startTransition(async () => {
      const r = await guardarPeticionServicios({ nino_id: ninoId, respuestas: nuevas })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      toast.success(t('corregida'))
      router.refresh()
    })
  }

  return (
    <section className="space-y-3" data-testid="peticion-servicios-direccion">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('direccion.titulo')}</h3>
        <p className="text-muted-foreground text-xs">{t('direccion.ayuda')}</p>
      </div>
      {faltan.length > 0 && (
        <p
          role="note"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-2 text-xs"
        >
          {t('direccion.sin_contestar', {
            servicios: faltan.map((s) => t(`servicio.${s}`)).join(', '),
          })}
        </p>
      )}
      <FilasServicios
        locale={locale}
        filas={filas}
        valores={valores}
        onChange={(s, v) => setValores((prev) => ({ ...prev, [s]: v }))}
        disabled={pending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={guardar}
        disabled={pending || !cambia || nuevas.length === 0}
      >
        {pending ? t('direccion.guardando') : t('direccion.guardar')}
      </Button>
    </section>
  )
}
