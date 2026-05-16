import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { CantidadComida, MomentoComida } from '@/features/agenda-diaria/schemas/agenda-diaria'

import { getMenuDelDia } from './get-menu-del-dia'
import type { MenuDelDia, NinoComidaResumen, PaseDeListaComidaPayload } from '../types'

interface MatriculaJoinNino {
  nino_id: string
  ninos: {
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
    foto_url: string | null
    centro_id: string
  } | null
}

/**
 * Pase de lista comida de un aula para (fecha, momento). Devuelve:
 *  - niños matriculados activos del aula con `nino_toma_comida_solida=true`
 *    (excluye lactantes exclusivos por F2.6: materna o biberon).
 *  - su `comida` actual para (nino_id, fecha, momento) si existe.
 *  - el menú del día (`menu_del_dia(centro, fecha)` SQL) o null si no hay
 *    plantilla publicada vigente.
 *
 * RLS:
 *  - matriculas/ninos: profe del aula o admin.
 *  - agendas_diarias + comidas: profe del aula o admin (Fase 3).
 *  - plantillas_menu (via menu_del_dia): pertenecer al centro.
 */
export async function getPaseDeListaComida(
  aulaId: string,
  fecha: string,
  momento: MomentoComida
): Promise<PaseDeListaComidaPayload> {
  const supabase = await createClient()

  // 1. Matrículas activas del aula con datos del niño y centro_id.
  const { data: matriculasRaw } = await supabase
    .from('matriculas')
    .select('nino_id, ninos(id, nombre, apellidos, fecha_nacimiento, foto_url, centro_id)')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const matriculas = (matriculasRaw ?? []) as MatriculaJoinNino[]
  const ninos = matriculas
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)

  const ninoIds = ninos.map((n) => n.id)
  const centroId = ninos[0]?.centro_id ?? null

  // Empty state: aula sin niños.
  if (ninos.length === 0 || !centroId) {
    return { fecha, momento, filas: [], menu: null }
  }

  // 2. Filtrar niños que NO toman comida sólida (RPC).
  //    Llamamos en paralelo a `nino_toma_comida_solida(id)` por niño.
  const tomaSolido = new Map<string, boolean>()
  await Promise.all(
    ninoIds.map(async (id) => {
      const { data } = await supabase.rpc('nino_toma_comida_solida', { p_nino_id: id })
      tomaSolido.set(id, Boolean(data ?? true))
    })
  )
  const ninosConSolido = ninos.filter((n) => tomaSolido.get(n.id) === true)
  const ninoIdsConSolido = ninosConSolido.map((n) => n.id)

  if (ninoIdsConSolido.length === 0) {
    const menu = await getMenuDelDia(centroId, fecha)
    return { fecha, momento, filas: [], menu }
  }

  // 3. Cabeceras `agendas_diarias` de hoy para esos niños.
  const { data: cabeceras } = await supabase
    .from('agendas_diarias')
    .select('id, nino_id')
    .in('nino_id', ninoIdsConSolido)
    .eq('fecha', fecha)
  const cabeceraByNino = new Map<string, string>(
    (cabeceras ?? []).map((c) => [c.nino_id, c.id as string])
  )
  const agendaIds = Array.from(cabeceraByNino.values())

  // 4. Comidas ya registradas para (agenda_id, momento).
  const comidaByNino = new Map<
    string,
    {
      id: string
      cantidad: CantidadComida
      descripcion: string | null
      observaciones: string | null
    }
  >()
  if (agendaIds.length > 0) {
    const { data: comidas } = await supabase
      .from('comidas')
      .select('id, agenda_id, cantidad, descripcion, observaciones')
      .in('agenda_id', agendaIds)
      .eq('momento', momento)
    // Map invertido agenda_id → nino_id.
    const ninoByAgenda = new Map<string, string>(
      Array.from(cabeceraByNino.entries()).map(([nino, agenda]) => [agenda, nino])
    )
    for (const row of (comidas ?? []) as Array<{
      id: string
      agenda_id: string
      cantidad: CantidadComida
      descripcion: string | null
      observaciones: string | null
    }>) {
      const ninoId = ninoByAgenda.get(row.agenda_id)
      if (!ninoId) continue
      comidaByNino.set(ninoId, {
        id: row.id,
        cantidad: row.cantidad,
        descripcion: row.descripcion,
        observaciones: row.observaciones,
      })
    }
  }

  // 5. Alertas médicas (mismo patrón que F3/F4).
  const { data: medicas } = await supabase
    .from('info_medica_emergencia')
    .select('nino_id, alergias_graves, medicacion_habitual')
    .in('nino_id', ninoIdsConSolido)
    .is('deleted_at', null)

  const alertasByNino = new Map<string, NinoComidaResumen['alertas']>()
  for (const row of (medicas ?? []) as Array<{
    nino_id: string
    alergias_graves: unknown
    medicacion_habitual: string | null
  }>) {
    alertasByNino.set(row.nino_id, {
      alergia_grave: row.alergias_graves !== null,
      medicacion: Boolean(row.medicacion_habitual && row.medicacion_habitual.trim().length > 0),
    })
  }

  // 6. Menú del día (separado, no en paralelo para no ensuciar el flow).
  const menu: MenuDelDia | null = await getMenuDelDia(centroId, fecha)

  const filas: NinoComidaResumen[] = ninosConSolido
    .map((n) => ({
      nino: {
        id: n.id,
        nombre: n.nombre,
        apellidos: n.apellidos,
        fecha_nacimiento: n.fecha_nacimiento,
        foto_url: n.foto_url,
      },
      comida: comidaByNino.get(n.id) ?? null,
      alertas: alertasByNino.get(n.id) ?? { alergia_grave: false, medicacion: false },
    }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))

  return { fecha, momento, filas, menu }
}
