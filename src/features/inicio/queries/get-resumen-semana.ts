import 'server-only'

import { getCitasRango } from '@/features/agenda/queries/get-citas-rango'
import { getDiasCerradosRango } from '@/features/calendario-centro/queries/get-dias-cerrados-rango'
import { getEventosRango } from '@/features/eventos/queries/get-eventos-rango'

import { construirResumen } from '../lib/construir-resumen'
import { ventanaSemana } from '../lib/ventana-semana'
import type { ResumenSemana } from '../types'

/**
 * Resumen del día + la semana ISO en curso (Europe/Madrid) para la pestaña de
 * Inicio (AG-15): combina eventos del Calendario Escolar (F7), citas de la
 * Agenda y cierres del centro (`dias_centro`) en una lista ordenada y
 * particionada en `hoy` / `semana`.
 *
 * El **ámbito por rol no se reimplementa**: la RLS de `eventos`, `citas` y
 * `dias_centro` ya devuelve solo lo que cada usuario puede ver (admin=centro,
 * profe=sus aulas, tutor=sus niños y sus invitaciones). Este agregador solo
 * lee, mezcla y ordena. Las citas se acotan por usuario (organizador/invitado),
 * no por centro: `getCitasRango` ya filtra por `auth.uid()` vía RLS.
 */
export async function getResumenSemana(centroId: string): Promise<ResumenSemana> {
  const ventana = ventanaSemana(new Date())
  const [citas, eventos, cierres] = await Promise.all([
    getCitasRango(ventana.desde, ventana.hasta),
    getEventosRango(centroId, ventana.desde, ventana.hasta),
    getDiasCerradosRango(centroId, ventana.desde, ventana.hasta),
  ])
  return construirResumen(ventana, citas, eventos, cierres)
}
