'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'

import { parseRespuestas } from '../lib/estructura'
import { resumenLote, type ResumenLote } from '../lib/lote'
import { publicarLoteSchema, type PublicarLoteInput } from '../schemas/informes'
import { fail, ok, type ActionResult } from '../types'

import { publicarInforme } from './gestionar-informe'

const E = 'informes.campana.errors'

function revalidarLote(): void {
  revalidatePath('/[locale]/teacher/informes', 'page')
  revalidatePath('/[locale]/admin/informes/campanas', 'page')
}

/**
 * Publica en lote (F9-5-3) los informes en **borrador** de una campaña **abierta**:
 * una aula (profe o dirección) o todas las del curso de la campaña (dirección "por
 * centro", sin `aula_id`). **Best-effort (Q8/Q5)**: reusa `publicarInforme` por
 * informe — publica los **completos** (todos los ítems valorados) y deja los
 * incompletos en borrador; **no crea ni rellena nada**. Cada publicación sella su
 * `notificado_at` (avisa a la familia una sola vez). La RLS de `informes_evolucion`
 * acota qué puede publicar cada rol (redactora de su aula; dirección del centro;
 * técnico/apoyo no). Devuelve el resumen `{ total, publicados, incompletos }`.
 */
export async function publicarLoteInformes(
  input: PublicarLoteInput
): Promise<ActionResult<ResumenLote>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(`${E}.no_autorizado`)

  const parsed = publicarLoteSchema.safeParse(input)
  if (!parsed.success) return fail(`${E}.lote_fallo`)
  const { campana_id, aula_id } = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail(`${E}.no_autorizado`)

  // La campaña debe existir, ser del centro y estar ABIERTA (no se publica en lote
  // sobre una cerrada). La RLS de `campanas_informe` ya restringe al staff del centro.
  const { data: campana } = await supabase
    .from('campanas_informe')
    .select('curso_academico_id, periodo, estado, centro_id')
    .eq('id', campana_id)
    .maybeSingle()
  if (!campana || campana.centro_id !== centroId || campana.estado !== 'abierta') {
    return fail(`${E}.lote_fallo`)
  }

  // Aulas objetivo: la indicada, o todas las del curso (dirección "por centro").
  let aulaIds: string[]
  if (aula_id) {
    aulaIds = [aula_id]
  } else {
    const { data: aulas } = await supabase
      .from('aulas_curso')
      .select('aula_id, aula:aulas!inner(deleted_at)')
      .eq('curso_academico_id', campana.curso_academico_id)
    aulaIds = (
      (aulas ?? []) as unknown as Array<{
        aula_id: string
        aula: { deleted_at: string | null } | null
      }>
    )
      .filter((r) => r.aula && r.aula.deleted_at === null)
      .map((r) => r.aula_id)
  }
  if (aulaIds.length === 0) return ok({ total: 0, publicados: 0, incompletos: 0 })

  // Niños con matrícula activa en esas aulas (Q3: bajas excluidas).
  const { data: mat } = await aplicarMatriculaActiva(
    supabase.from('matriculas').select('nino_id').in('aula_id', aulaIds)
  )
  const ninoIds = (mat ?? []).map((m) => m.nino_id)
  if (ninoIds.length === 0) return ok({ total: 0, publicados: 0, incompletos: 0 })

  // Informes en BORRADOR de la terna (curso, período) de esos niños. Los publicados
  // ya están; los "sin empezar" no existen como fila (no se crean — Q5).
  const { data: borradores } = await supabase
    .from('informes_evolucion')
    .select('id, respuestas, observaciones_generales')
    .eq('curso_academico_id', campana.curso_academico_id)
    .eq('periodo', campana.periodo)
    .eq('estado', 'borrador')
    .in('nino_id', ninoIds)
  const lista = borradores ?? []
  if (lista.length === 0) return ok({ total: 0, publicados: 0, incompletos: 0 })

  // Best-effort: `publicarInforme` valida "todos valorados" y publica; los
  // incompletos devuelven fail y se quedan en borrador. Secuencial (volumen pequeño).
  const resultados: ActionResult<{ informe_id: string }>[] = []
  for (const b of lista) {
    resultados.push(
      await publicarInforme({
        informe_id: b.id,
        respuestas: parseRespuestas(b.respuestas),
        observaciones_generales: b.observaciones_generales,
      })
    )
  }

  revalidarLote()
  return ok(resumenLote(resultados))
}
