import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type {
  CantidadComida,
  MomentoComida,
  PaseDeListaComidaFila,
  PaseDeListaComidaState,
  TipoPlatoComida,
} from '../types'

interface MatriculaJoinNino {
  ninos: {
    id: string
    nombre: string
    apellidos: string
    foto_url: string | null
  } | null
}

interface AulaCentro {
  centro_id: string
}

const MOMENTOS: MomentoComida[] = ['desayuno', 'media_manana', 'comida', 'merienda']

/**
 * Compone el estado del pase de lista comida para los 4 momentos en una
 * sola pasada server-side. Reutiliza los lookups comunes (aula, tipo de
 * día, plantilla, menu_dia, niños, alergias, comidas existentes) y
 * construye los 4 estados en memoria.
 *
 * Devuelve `Record<MomentoComida, PaseDeListaComidaState>` para que el
 * cliente cambie de momento como state local instantáneo, sin re-fetch.
 *
 * Reduce de 5+ queries por momento × 4 momentos = 20+ queries
 * secuenciales a ~8 queries totales. La query de `comidas` filtra por
 * `momento IN (...4 momentos)` en una sola pasada.
 *
 * Las 3 ramas tempranas (centro cerrado, sin plantilla, día sin menú)
 * producen el MISMO estado para los 4 momentos — si el centro está
 * cerrado, ningún momento tiene pase de lista. Si hay menú, los 4
 * momentos son `kind: 'listo'` con el mismo array `filas`/`existentes`
 * (filtrados por momento).
 */
export async function getPaseDeListaComidaTodosMomentos(
  aulaId: string,
  fecha: string
): Promise<Record<MomentoComida, PaseDeListaComidaState>> {
  const supabase = await createClient()

  const { data: aula } = await supabase
    .from('aulas')
    .select('centro_id')
    .eq('id', aulaId)
    .maybeSingle()

  if (!aula) {
    return broadcastSinPlantilla()
  }
  const centroId = (aula as AulaCentro).centro_id

  // 1. Centro abierto?
  const { data: tipoDia } = await supabase.rpc('tipo_de_dia', {
    p_centro_id: centroId,
    p_fecha: fecha,
  })
  const abiertos = ['lectivo', 'escuela_verano', 'escuela_navidad', 'jornada_reducida']
  if (tipoDia && !abiertos.includes(tipoDia)) {
    return broadcast({
      kind: 'centro_cerrado',
      tipo: tipoDia as Extract<PaseDeListaComidaState, { kind: 'centro_cerrado' }>['tipo'],
    })
  }

  // 2. Plantilla publicada del mes?
  const [anio, mes] = fecha.split('-').map((s) => Number(s))
  const { data: plantilla } = await supabase
    .from('plantillas_menu_mensual')
    .select('id')
    .eq('centro_id', centroId)
    .eq('estado', 'publicada')
    .eq('mes', mes)
    .eq('anio', anio)
    .is('deleted_at', null)
    .maybeSingle()

  if (!plantilla) {
    return broadcastSinPlantilla()
  }

  // 3. menu_dia para la fecha?
  const { data: menu } = await supabase
    .from('menu_dia')
    .select('*')
    .eq('plantilla_id', plantilla.id)
    .eq('fecha', fecha)
    .maybeSingle()

  if (!menu) {
    return broadcast({ kind: 'dia_sin_menu' })
  }

  // 4. Niños del aula con matrícula activa.
  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('ninos(id, nombre, apellidos, foto_url)')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const ninosBruto = ((matriculas ?? []) as MatriculaJoinNino[])
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)

  if (ninosBruto.length === 0) {
    return broadcast({ kind: 'listo', menu, filas: [], existentes: [] })
  }

  // 5. Filtrar via nino_toma_comida_solida en paralelo.
  const solidosChecks = await Promise.all(
    ninosBruto.map(async (n) => {
      const { data, error } = await supabase.rpc('nino_toma_comida_solida', {
        p_nino_id: n.id,
      })
      if (error) {
        logger.warn('nino_toma_comida_solida failed', error.message)
        return { ninoId: n.id, toma: true }
      }
      return { ninoId: n.id, toma: Boolean(data) }
    })
  )
  const ninosIdsSolidos = new Set(solidosChecks.filter((c) => c.toma).map((c) => c.ninoId))
  const ninos = ninosBruto.filter((n) => ninosIdsSolidos.has(n.id))

  // 6. Alergias graves + agendas en paralelo (1 query cada una).
  const ninoIds = ninos.map((n) => n.id)
  const [medicasRes, agendasRes] = await Promise.all([
    supabase
      .from('info_medica_emergencia')
      .select('nino_id, alergias_graves')
      .in('nino_id', ninoIds)
      .is('deleted_at', null),
    supabase
      .from('agendas_diarias')
      .select('id, nino_id')
      .in('nino_id', ninoIds)
      .eq('fecha', fecha),
  ])

  const alergiaByNino = new Map<string, boolean>()
  for (const m of (medicasRes.data ?? []) as Array<{ nino_id: string; alergias_graves: unknown }>) {
    alergiaByNino.set(m.nino_id, m.alergias_graves !== null)
  }
  const agendaIdByNino = new Map<string, string>(
    ((agendasRes.data ?? []) as Array<{ id: string; nino_id: string }>).map((a) => [
      a.nino_id,
      a.id,
    ])
  )

  const filas: PaseDeListaComidaFila[] = ninos
    .map((n) => ({ nino: n, alergiaGrave: alergiaByNino.get(n.id) ?? false }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))

  // 7. Comidas existentes para los 4 momentos en una sola query.
  const agendaIds = Array.from(agendaIdByNino.values())
  const existentesPorMomento: Record<
    MomentoComida,
    Array<{
      nino_id: string
      tipo_plato: TipoPlatoComida
      cantidad: CantidadComida
      descripcion: string | null
      comida_id: string
    }>
  > = {
    desayuno: [],
    media_manana: [],
    comida: [],
    merienda: [],
  }

  if (agendaIds.length > 0) {
    const { data: comidas } = await supabase
      .from('comidas')
      .select('id, agenda_id, momento, cantidad, descripcion, tipo_plato')
      .in('agenda_id', agendaIds)
      .not('tipo_plato', 'is', null)

    const agendaToNino = new Map<string, string>()
    for (const [nino, ag] of agendaIdByNino.entries()) agendaToNino.set(ag, nino)

    for (const c of (comidas ?? []) as Array<{
      id: string
      agenda_id: string
      momento: MomentoComida
      cantidad: CantidadComida
      descripcion: string | null
      tipo_plato: TipoPlatoComida
    }>) {
      existentesPorMomento[c.momento].push({
        nino_id: agendaToNino.get(c.agenda_id)!,
        tipo_plato: c.tipo_plato,
        cantidad: c.cantidad,
        descripcion: c.descripcion,
        comida_id: c.id,
      })
    }
  }

  // Construir los 4 estados con menú compartido (todos `kind: 'listo'`).
  const result = {} as Record<MomentoComida, PaseDeListaComidaState>
  for (const m of MOMENTOS) {
    result[m] = {
      kind: 'listo',
      menu,
      filas,
      existentes: existentesPorMomento[m],
    }
  }
  return result
}

function broadcast(state: PaseDeListaComidaState): Record<MomentoComida, PaseDeListaComidaState> {
  const r = {} as Record<MomentoComida, PaseDeListaComidaState>
  for (const m of MOMENTOS) r[m] = state
  return r
}

function broadcastSinPlantilla(): Record<MomentoComida, PaseDeListaComidaState> {
  return broadcast({ kind: 'sin_plantilla_publicada' })
}
