import 'server-only'

import { getAutorizacionesFamilia } from '@/features/autorizaciones/queries/get-autorizaciones-familia'
import { hoyMadridYmd } from '@/features/autorizaciones/lib/server-helpers'
import { createClient } from '@/lib/supabase/server'

import { cutoffNovedades, esStaff, getFirmasVistas, type RolNotif } from '../lib/helpers'
import type { AvisosInicio } from '../types'

const VACIO: AvisosInicio = {
  pendientesConfirmar: 0,
  pendientesFirma: 0,
  confirmadas: 0,
  firmadas: 0,
  medicacionesActivas: 0,
  nuevasFirmas: 0,
  revocaciones: 0,
}

/**
 * Contadores del aviso de inicio (punto 2), según rol — **resumen de estado**, no
 * solo lo pendiente (punto 3: muestra también las firmadas/confirmadas). La RLS
 * filtra el ámbito:
 *  - Staff: administraciones **pendientes de TU confirmación** (lo principal, B) +
 *    **confirmadas** (resumen) + medicaciones activas hoy.
 *  - Familia: autorizaciones **pendientes de tu firma** + **firmadas** (resumen) +
 *    medicaciones activas de tus hijos.
 *
 * "Medicación activa hoy" se aproxima por la ventana de vigencia de la instancia
 * (publicada, no caducada: hoy ≤ vigencia_hasta). Es un recordatorio de administrar
 * según pauta; el gate exacto (firmada + vigente) sigue gobernando el botón Registrar.
 */
export async function getAvisosInicio(rol: RolNotif): Promise<AvisosInicio> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return VACIO

  const hoy = hoyMadridYmd()

  const meds = await supabase
    .from('autorizaciones')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'medicacion')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .gte('vigencia_hasta', hoy)
  const medicacionesActivas = meds.count ?? 0

  if (esStaff(rol)) {
    const [pc, conf, nf, rev, vistas] = await Promise.all([
      supabase
        .from('administraciones_medicacion')
        .select('id', { count: 'exact', head: true })
        .is('confirmado_por', null)
        .neq('administrado_por', user.id),
      supabase
        .from('administraciones_medicacion')
        .select('id', { count: 'exact', head: true })
        .not('confirmado_por', 'is', null),
      // "Ha llegado una firma nueva": recogidas/medicaciones que una familia firmó
      // recientemente en tu ámbito (RLS), excluyendo tus propias firmas. Se traen las
      // filas (no count) para descontar las ya VISTAS (autorización abierta después
      // de la firma).
      supabase
        .from('firmas_autorizacion')
        .select('autorizacion_id, created_at, autorizaciones!inner(tipo, es_plantilla)')
        .eq('decision', 'firmado')
        .neq('firmante_id', user.id)
        .gte('created_at', cutoffNovedades())
        .eq('autorizaciones.es_plantilla', false)
        .in('autorizaciones.tipo', ['recogida', 'medicacion']),
      // Revocaciones (alerta de seguridad): cambió quién recoge / se paró una medicina.
      supabase
        .from('firmas_autorizacion')
        .select('autorizacion_id, created_at, autorizaciones!inner(tipo, es_plantilla)')
        .eq('decision', 'revocado')
        .neq('firmante_id', user.id)
        .gte('created_at', cutoffNovedades())
        .eq('autorizaciones.es_plantilla', false)
        .in('autorizaciones.tipo', ['recogida', 'medicacion']),
      getFirmasVistas(),
    ])

    // Una firma/revocación cuenta como "nueva" si su autorización no se ha abierto
    // después (mapa de vistas por-autorización, comparado por instante).
    const noVista = (autorizacionId: string, createdAt: string) => {
      const visto = vistas[autorizacionId]
      return !visto || new Date(createdAt).getTime() > new Date(visto).getTime()
    }
    const nuevasFirmas = (nf.data ?? []).filter((r) =>
      noVista(r.autorizacion_id, r.created_at)
    ).length
    const revocaciones = (rev.data ?? []).filter((r) =>
      noVista(r.autorizacion_id, r.created_at)
    ).length

    return {
      pendientesConfirmar: pc.count ?? 0,
      pendientesFirma: 0,
      confirmadas: conf.count ?? 0,
      firmadas: 0,
      medicacionesActivas,
      nuevasFirmas,
      revocaciones,
    }
  }

  // Familia: instancias firmables con su firma aún pendiente + las ya firmadas
  // (reusa la query de familia, que resuelve estado_firma propio por instancia).
  const lista = await getAutorizacionesFamilia()
  const pendientesFirma = lista.filter(
    (a) =>
      a.estado_firma === 'pendiente' &&
      a.texto_definitivo &&
      (!a.vigencia_desde || hoy >= a.vigencia_desde) &&
      (!a.vigencia_hasta || hoy <= a.vigencia_hasta)
  ).length
  const firmadas = lista.filter((a) => a.estado_firma === 'firmado').length

  return {
    pendientesConfirmar: 0,
    pendientesFirma,
    confirmadas: 0,
    firmadas,
    medicacionesActivas,
    nuevasFirmas: 0,
    revocaciones: 0,
  }
}
