import 'server-only'

import { getAutorizacionesFamilia } from '@/features/autorizaciones/queries/get-autorizaciones-familia'
import { hoyMadridYmd } from '@/features/autorizaciones/lib/server-helpers'
import { getPendientesCampanaProfe } from '@/features/informes/queries/get-pendientes-campana-profe'
import { createClient } from '@/lib/supabase/server'

import { contarNoVistas } from '../lib/derivar'
import {
  cutoffNovedades,
  esStaff,
  getFirmasVistas,
  getFotosVistas,
  getInformesVistos,
  type RolNotif,
} from '../lib/helpers'
import type { AvisosInicio } from '../types'

const VACIO: AvisosInicio = {
  pendientesConfirmar: 0,
  pendientesFirma: 0,
  confirmadas: 0,
  firmadas: 0,
  medicacionesActivas: 0,
  nuevasFirmas: 0,
  revocaciones: 0,
  medicacionesPorArchivar: 0,
  informesNuevos: 0,
  fotosNuevas: 0,
  campanaPendientes: null,
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
    const [pc, conf, nf, rev, archivar, vistas, campanaPendientes] = await Promise.all([
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
      // Medicaciones TERMINADAS (hoy > fecha_fin) aún sin archivar → recordatorio de archivar.
      supabase
        .from('autorizaciones')
        .select('id', { count: 'exact', head: true })
        .eq('tipo', 'medicacion')
        .eq('es_plantilla', false)
        .is('archivada_at', null)
        .lt('vigencia_hasta', hoy),
      getFirmasVistas(),
      // Informes pendientes de campaña para la profe redactora (F9-5-2). Devuelve
      // null para admin (sin aulas de redacción) y si no queda nada pendiente.
      getPendientesCampanaProfe(),
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
      medicacionesPorArchivar: archivar.count ?? 0,
      informesNuevos: 0,
      fotosNuevas: 0,
      campanaPendientes,
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

  // Informes de evolución PUBLICADOS de sus hijos que aún no ha abierto (F9-3). La
  // RLS de `informes_evolucion` ya filtra a publicados legibles por esta familia;
  // descontamos los que están en el marcador `informes_vistos` (presencia).
  const [pub, vistos] = await Promise.all([
    supabase.from('informes_evolucion').select('id').eq('estado', 'publicado'),
    getInformesVistos(),
  ])
  const informesNuevos = contarNoVistas(pub.data ?? [], vistos)

  // Publicaciones del blog visibles para esta familia (RLS → P2 aula actual +
  // P-histórico etiquetado, solo con `puede_ver_fotos`) que aún no ha abierto (F10-2).
  const [fotos, fotosVistas] = await Promise.all([
    supabase.from('publicaciones').select('id'),
    getFotosVistas(),
  ])
  const fotosNuevas = contarNoVistas(fotos.data ?? [], fotosVistas)

  return {
    pendientesConfirmar: 0,
    pendientesFirma,
    confirmadas: 0,
    firmadas,
    medicacionesActivas,
    nuevasFirmas: 0,
    revocaciones: 0,
    medicacionesPorArchivar: 0,
    informesNuevos,
    fotosNuevas,
    campanaPendientes: null,
  }
}
