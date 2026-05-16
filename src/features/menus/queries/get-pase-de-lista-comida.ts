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

/**
 * Compone el estado del pase de lista comida para (aulaId, fecha, momento).
 *
 * Cubre los 4 casos posibles como discriminated union:
 *  - centro cerrado (festivo/vacaciones/fin de semana/cerrado).
 *  - centro abierto pero sin plantilla publicada para el mes.
 *  - plantilla publicada pero ese día concreto no tiene menu_dia.
 *  - listo: menú + niños que toman sólidos + comidas existentes.
 *
 * RLS filtra automáticamente cada SELECT — un usuario sin acceso al
 * aula recibe arrays vacíos.
 */
export async function getPaseDeListaComida(
  aulaId: string,
  fecha: string,
  momento: MomentoComida
): Promise<PaseDeListaComidaState> {
  const supabase = await createClient()

  const { data: aula } = await supabase
    .from('aulas')
    .select('centro_id')
    .eq('id', aulaId)
    .maybeSingle()

  if (!aula) {
    return { kind: 'sin_plantilla_publicada' }
  }
  const centroId = (aula as AulaCentro).centro_id

  // 1. Centro abierto? Si no, devuelve el tipo del día.
  const { data: tipoDia } = await supabase.rpc('tipo_de_dia', {
    p_centro_id: centroId,
    p_fecha: fecha,
  })
  const abiertos = ['lectivo', 'escuela_verano', 'escuela_navidad', 'jornada_reducida']
  if (tipoDia && !abiertos.includes(tipoDia)) {
    return {
      kind: 'centro_cerrado',
      tipo: tipoDia as PaseDeListaComidaState extends { kind: 'centro_cerrado' }
        ? PaseDeListaComidaState['tipo']
        : never,
    }
  }

  // 2. Hay plantilla publicada para mes/año?
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
    return { kind: 'sin_plantilla_publicada' }
  }

  // 3. Hay menu_dia para esa fecha?
  const { data: menu } = await supabase
    .from('menu_dia')
    .select('*')
    .eq('plantilla_id', plantilla.id)
    .eq('fecha', fecha)
    .maybeSingle()

  if (!menu) {
    return { kind: 'dia_sin_menu' }
  }

  // 4. Listar niños del aula que toman sólidos.
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
    return {
      kind: 'listo',
      menu,
      filas: [],
      existentes: [],
    }
  }

  // Filtrar via helper nino_toma_comida_solida (excluye materna/biberon).
  const solidosChecks = await Promise.all(
    ninosBruto.map(async (n) => {
      const { data, error } = await supabase.rpc('nino_toma_comida_solida', {
        p_nino_id: n.id,
      })
      if (error) {
        logger.warn('nino_toma_comida_solida failed', error.message)
        return { ninoId: n.id, toma: true } // fallback seguro: incluir
      }
      return { ninoId: n.id, toma: Boolean(data) }
    })
  )
  const ninosIdsSolidos = new Set(solidosChecks.filter((c) => c.toma).map((c) => c.ninoId))
  const ninos = ninosBruto.filter((n) => ninosIdsSolidos.has(n.id))

  // Alergias graves para el badge en la fila.
  const { data: medicas } = await supabase
    .from('info_medica_emergencia')
    .select('nino_id, alergias_graves')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .is('deleted_at', null)

  const alergiaByNino = new Map<string, boolean>()
  for (const m of (medicas ?? []) as Array<{ nino_id: string; alergias_graves: unknown }>) {
    alergiaByNino.set(m.nino_id, m.alergias_graves !== null)
  }

  const filas: PaseDeListaComidaFila[] = ninos
    .map((n) => ({
      nino: n,
      alergiaGrave: alergiaByNino.get(n.id) ?? false,
    }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))

  // 5. Comidas ya registradas para esos niños/fecha/momento, filtradas
  //    por tipo_plato no nulo (las del batch del pase de lista). Necesitamos
  //    saber la agenda_id de cada niño para esa fecha.
  const { data: agendas } = await supabase
    .from('agendas_diarias')
    .select('id, nino_id')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .eq('fecha', fecha)

  const agendaIdByNino = new Map<string, string>(
    ((agendas ?? []) as Array<{ id: string; nino_id: string }>).map((a) => [a.nino_id, a.id])
  )

  const agendaIds = Array.from(agendaIdByNino.values())
  let existentes: Array<{
    nino_id: string
    tipo_plato: TipoPlatoComida
    cantidad: CantidadComida
    descripcion: string | null
    comida_id: string
  }> = []

  if (agendaIds.length > 0) {
    const { data: comidas } = await supabase
      .from('comidas')
      .select('id, agenda_id, momento, cantidad, descripcion, tipo_plato')
      .in('agenda_id', agendaIds)
      .eq('momento', momento)
      .not('tipo_plato', 'is', null)

    const agendaToNino = new Map<string, string>()
    for (const [nino, ag] of agendaIdByNino.entries()) agendaToNino.set(ag, nino)

    existentes = (
      (comidas ?? []) as Array<{
        id: string
        agenda_id: string
        cantidad: CantidadComida
        descripcion: string | null
        tipo_plato: TipoPlatoComida
      }>
    ).map((c) => ({
      nino_id: agendaToNino.get(c.agenda_id)!,
      tipo_plato: c.tipo_plato,
      cantidad: c.cantidad,
      descripcion: c.descripcion,
      comida_id: c.id,
    }))
  }

  return {
    kind: 'listo',
    menu,
    filas,
    existentes,
  }
}
