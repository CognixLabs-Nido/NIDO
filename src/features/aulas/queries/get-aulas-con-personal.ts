import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { TIPO_PERSONAL_AULA_ORDER, type TipoPersonalAula } from '@/features/profes-aulas/types'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import type { AulaListItem } from './get-aulas'

/**
 * F5B-#34 — Query enriquecida para la tabla `/admin/aulas` (PR #35).
 *
 * Devuelve, por aula del curso académico dado, el desglose de personal
 * por tipo (coordinadora/profesora/tecnico/apoyo) y el conteo de
 * matriculas activas. El backend solo se encarga de servir los datos;
 * el render concreto (badges, orden visual, columnas) llega en PR #35.
 *
 * Estrategia (decisión D6, Opción A): 3 queries TS paralelizadas con
 * `Promise.all` (lección PR #32). Sin RPC SQL — ANAIA típicamente tiene
 * <10 aulas, muy por debajo del umbral donde un round-trip extra
 * justifique mover lógica a Postgres.
 *
 * Forma del retorno:
 *   - `profesoras[]` mezcla coordinadora + profesora regular, con
 *     coordinadora primero (por TIPO_PERSONAL_AULA_ORDER) y luego
 *     alfabético. Cada item conserva su `tipo_personal_aula` para que
 *     la UI pueda resaltar la coordinadora con un badge distinto.
 *   - `tecnicos[]` y `apoyos[]` agrupan los otros dos valores del
 *     ENUM, alfabéticos. Permanecen separados para columnas dedicadas
 *     en la tabla.
 */
export interface PersonalMin {
  id: string
  nombre_completo: string
  tipo_personal_aula: TipoPersonalAula
}

export interface AulaConPersonal extends AulaListItem {
  num_alumnos: number
  /** Coordinadora + profesoras regulares, coordinadora primero, alfabético dentro de cada tipo. */
  profesoras: PersonalMin[]
  /** Solo `tipo_personal_aula = 'tecnico'`. */
  tecnicos: PersonalMin[]
  /** Solo `tipo_personal_aula = 'apoyo'`. */
  apoyos: PersonalMin[]
}

export async function getAulasConPersonal(cursoAcademicoId: string): Promise<AulaConPersonal[]> {
  const supabase = await createClient()
  return getAulasConPersonalCore(supabase, cursoAcademicoId)
}

/**
 * Núcleo testeable. Recibe el cliente Supabase (real en prod, fake en
 * vitest) y un curso. Mismo patrón que `getVinculosTutoresAulaCore`.
 */
export async function getAulasConPersonalCore(
  supabase: SupabaseClient<Database>,
  cursoAcademicoId: string
): Promise<AulaConPersonal[]> {
  const { data: aulas, error: aulasErr } = await supabase
    .from('aulas')
    .select('id, centro_id, nombre, cohorte_anos_nacimiento, capacidad_maxima, descripcion')
    .eq('curso_academico_id', cursoAcademicoId)
    .is('deleted_at', null)
    .order('nombre', { ascending: true })

  if (aulasErr) {
    logger.warn('getAulasConPersonal: aulas', aulasErr.message)
    return []
  }

  const aulasList = (aulas ?? []) as AulaListItem[]
  if (aulasList.length === 0) return []

  const aulaIds = aulasList.map((a) => a.id)

  // Promise.all: matriculas activas y profes activos en paralelo. Las
  // dos lecturas son independientes — la spec de D6 lo exige
  // explicitamente (lección PR #32).
  const [{ data: matriculas, error: matErr }, { data: profes, error: profesErr }] =
    await Promise.all([
      supabase
        .from('matriculas')
        .select('aula_id')
        .in('aula_id', aulaIds)
        .is('fecha_baja', null)
        .is('deleted_at', null),
      supabase
        .from('profes_aulas')
        .select(
          `
          aula_id,
          tipo_personal_aula,
          profe:usuarios!inner(id, nombre_completo)
          `
        )
        .in('aula_id', aulaIds)
        .is('fecha_fin', null)
        .is('deleted_at', null),
    ])

  if (matErr) logger.warn('getAulasConPersonal: matriculas', matErr.message)
  if (profesErr) logger.warn('getAulasConPersonal: profes_aulas', profesErr.message)

  // Conteos de alumnos por aula.
  const numAlumnosPorAula = new Map<string, number>()
  for (const m of matriculas ?? []) {
    numAlumnosPorAula.set(m.aula_id, (numAlumnosPorAula.get(m.aula_id) ?? 0) + 1)
  }

  // Buckets de personal por aula y tipo.
  const profesPorAula = new Map<string, PersonalMin[]>()
  const tecnicosPorAula = new Map<string, PersonalMin[]>()
  const apoyosPorAula = new Map<string, PersonalMin[]>()

  for (const p of profes ?? []) {
    if (!p.profe) continue
    const persona: PersonalMin = {
      id: p.profe.id,
      nombre_completo: p.profe.nombre_completo,
      tipo_personal_aula: p.tipo_personal_aula,
    }
    if (p.tipo_personal_aula === 'coordinadora' || p.tipo_personal_aula === 'profesora') {
      const bucket = profesPorAula.get(p.aula_id) ?? []
      bucket.push(persona)
      profesPorAula.set(p.aula_id, bucket)
    } else if (p.tipo_personal_aula === 'tecnico') {
      const bucket = tecnicosPorAula.get(p.aula_id) ?? []
      bucket.push(persona)
      tecnicosPorAula.set(p.aula_id, bucket)
    } else if (p.tipo_personal_aula === 'apoyo') {
      const bucket = apoyosPorAula.get(p.aula_id) ?? []
      bucket.push(persona)
      apoyosPorAula.set(p.aula_id, bucket)
    }
  }

  const ordenarProfesoras = (a: PersonalMin, b: PersonalMin): number => {
    const pesoA = TIPO_PERSONAL_AULA_ORDER[a.tipo_personal_aula]
    const pesoB = TIPO_PERSONAL_AULA_ORDER[b.tipo_personal_aula]
    if (pesoA !== pesoB) return pesoA - pesoB
    return a.nombre_completo.localeCompare(b.nombre_completo)
  }
  const ordenarAlfabetico = (a: PersonalMin, b: PersonalMin): number =>
    a.nombre_completo.localeCompare(b.nombre_completo)

  return aulasList.map((aula) => ({
    ...aula,
    num_alumnos: numAlumnosPorAula.get(aula.id) ?? 0,
    profesoras: (profesPorAula.get(aula.id) ?? []).sort(ordenarProfesoras),
    tecnicos: (tecnicosPorAula.get(aula.id) ?? []).sort(ordenarAlfabetico),
    apoyos: (apoyosPorAula.get(aula.id) ?? []).sort(ordenarAlfabetico),
  }))
}
