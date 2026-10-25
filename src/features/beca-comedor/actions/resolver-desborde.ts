'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { origenExceso } from '../lib/origen-exceso'
import { mesSiguiente, repartirExceso, type BecaNino } from '../lib/reparto-desborde'
import { resolverDesbordeSchema, type ResolverDesbordeInput } from '../schemas/beca-comedor'

const RUTA = '/[locale]/admin/cuotas'
const ERR = 'admin.cuotas.beca_comedor.desborde.errors'

// PR-1c: el HINT de cada RAISE de `resolver_sobrante_cheque`, a su clave.
const POR_HINT_CHEQUE: Record<string, string> = {
  no_existe: `${ERR}.no_existe`,
  ya_resuelto: `${ERR}.ya_resuelto`,
  via_invalida: `${ERR}.invalid`,
  sin_hijos: `${ERR}.sin_hijos_cheque`,
  recibo_siguiente_cerrado: `${ERR}.recibo_siguiente_cerrado`,
  mes_siguiente_cerrado: `${ERR}.mes_siguiente_cerrado`,
}

type Supa = SupabaseClient<Database>

/** ¿El mes (año, mes) del centro está CERRADO? (fila en cierre_mensual). */
async function mesEstaCerrado(
  supabase: Supa,
  centroId: string,
  anio: number,
  mes: number
): Promise<boolean> {
  const { data } = await supabase
    .from('cierre_mensual')
    .select('id')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()
  return data != null
}

/**
 * V2-4 — RESOLVER el desborde de un recibo por una de las DOS vías:
 *   · 'diferir'       → crea tramos `origen='resto'` (reparto por niño, resto mayor) con
 *                       aplicación en el MES SIGUIENTE. Regen-safe: el motor los reaplica y
 *                       re-capa (nunca deja el recibo en negativo). Se guarda via='reducir'.
 *   · 'transferencia' → crea/activa la fila beca_comedor_transferencia (por familia,
 *                       importe = exceso, estado 'pendiente'). El listado vive en Remesas.
 *
 * En ambas marca el desborde como RESUELTO (vía + resuelto_por/at). No toca el motor ni el
 * modelo. Claim atómico del desborde (pendiente→resuelto) antes del efecto; si el efecto
 * falla, revierte el claim. RLS admin del centro es la puerta.
 *
 * PR-1c: el sobrante de un cheque (`origen = 'cheque'`) lo resuelve entero la BD, en una
 * transacción (`resolver_sobrante_cheque`): diferir es una línea de saldo a favor en el recibo del
 * mes siguiente, y transferencia, la misma fila de transferencia con su origen.
 */
export async function resolverDesborde(
  input: ResolverDesbordeInput
): Promise<ActionResult<{ via: 'diferir' | 'transferencia'; n: number }>> {
  const parsed = resolverDesbordeSchema.safeParse(input)
  if (!parsed.success) return fail(`${ERR}.invalid`)
  const { recibo_id, via, origen } = parsed.data

  const supabase = await createClient()

  // Desborde de este recibo y de ese origen (RLS ya restringe a admin del centro): un recibo puede
  // tener el de su beca y el sobrante de su cheque (PR-1c). `*` para leer el origen también antes
  // de que exista la columna. Su centro es el de la acción (multicentro · Fase 1), no el centro
  // activo, y se exige ser admin en él.
  const { data: desbordes } = await supabase
    .from('beca_comedor_desborde')
    .select('*')
    .eq('recibo_id', recibo_id)
  const desborde = (desbordes ?? []).find((d) => origenExceso(d) === origen)
  if (!desborde) return fail(`${ERR}.no_existe`)
  const centroId = desborde.centro_id
  if (!(await usuarioAdminEn(supabase, centroId))) return fail(`${ERR}.no_autorizado`)
  if (desborde.estado !== 'pendiente') return fail(`${ERR}.ya_resuelto`)

  if (origen === 'cheque') {
    const { error } = await supabase.rpc('resolver_sobrante_cheque', {
      p_recibo_id: recibo_id,
      p_via: via,
    })
    if (error) {
      logger.warn('resolverDesborde cheque', error.message)
      if (error.code === '42501') return fail(`${ERR}.no_autorizado`)
      const clave = error.hint ? POR_HINT_CHEQUE[error.hint] : undefined
      return fail(clave ?? `${ERR}.save_failed`)
    }
    revalidatePath(RUTA, 'page')
    return ok({ via, n: 1 })
  }

  // ── Preparar el efecto ANTES del claim (para validar sin dejar el desborde a medias) ──
  let restoRows: Database['public']['Tables']['beca_comedor_tramo']['Insert'][] = []
  let sig: { anio: number; mes: number } | null = null
  // Todos los hijos ACTIVOS de la familia (no solo los del reparto): el DELETE de resto
  // previos barre por este conjunto para no dejar colgado el resto de un hijo que perdió la
  // beca entre resolver y re-resolver.
  let familiaNinoIds: string[] = []

  if (via === 'diferir') {
    sig = mesSiguiente(desborde.anio, desborde.mes)
    if (await mesEstaCerrado(supabase, centroId, sig.anio, sig.mes)) {
      return fail(`${ERR}.mes_siguiente_cerrado`)
    }

    // Hijos ACTIVOS de la familia.
    const { data: ninos } = await supabase
      .from('ninos')
      .select('id, matriculas!inner(estado, fecha_baja, deleted_at)')
      .eq('familia_id', desborde.familia_id)
      .eq('matriculas.estado', 'activa')
      .is('matriculas.fecha_baja', null)
      .is('matriculas.deleted_at', null)
      .is('deleted_at', null)
    const ninoIds = [...new Set((ninos ?? []).map((n) => n.id))]
    if (ninoIds.length === 0) return fail(`${ERR}.sin_hijos`)
    familiaNinoIds = ninoIds

    // Beca de cada hijo en el desborde = los tramos que descuenta ESTE recibo: los de sus
    // líneas de beca (PR-5, `lineas_recibo.beca_tramo_id`), que es lo que sumó el motor. No
    // «los pendientes del mes»: un tramo pasa a `aplicada` al validarse su recibo, y una carga
    // creada después de generar el borrador está pendiente pero no está en él.
    const { data: lineasBeca } = await supabase
      .from('lineas_recibo')
      .select('beca_tramo_id')
      .eq('centro_id', centroId)
      .eq('recibo_id', desborde.recibo_id)
      .not('beca_tramo_id', 'is', null)
    const tramoIds = [
      ...new Set((lineasBeca ?? []).flatMap((l) => (l.beca_tramo_id ? [l.beca_tramo_id] : []))),
    ]
    const { data: tramos } =
      tramoIds.length === 0
        ? { data: [] }
        : await supabase
            .from('beca_comedor_tramo')
            .select('nino_id, importe_centimos, curso_academico_id')
            .eq('centro_id', centroId)
            .in('id', tramoIds)
            .in('nino_id', ninoIds)

    const becaPorNino = new Map<string, number>()
    const cursoPorNino = new Map<string, string>()
    for (const t of tramos ?? []) {
      becaPorNino.set(t.nino_id, (becaPorNino.get(t.nino_id) ?? 0) + t.importe_centimos)
      cursoPorNino.set(t.nino_id, t.curso_academico_id)
    }
    const becas: BecaNino[] = [...becaPorNino].map(([ninoId, becaCentimos]) => ({
      ninoId,
      becaCentimos,
    }))

    const reparto = repartirExceso(desborde.exceso_centimos, becas)
    if (reparto.length === 0) return fail(`${ERR}.sin_becas`)
    // Invariante del reparto (resto mayor): suma EXACTA. Nunca debería fallar; si falla,
    // NO dejamos descuadrar el recibo — abortamos.
    const sumado = reparto.reduce((acc, r) => acc + r.restoCentimos, 0)
    if (sumado !== desborde.exceso_centimos) {
      logger.error('resolverDesborde descuadre reparto', {
        exceso: desborde.exceso_centimos,
        sumado,
      })
      return fail(`${ERR}.descuadre`)
    }

    restoRows = reparto.map((r) => ({
      centro_id: centroId,
      nino_id: r.ninoId,
      curso_academico_id: cursoPorNino.get(r.ninoId)!,
      anio_correspondiente: desborde.anio,
      mes_correspondiente: desborde.mes,
      anio_aplicacion: sig!.anio,
      mes_aplicacion: sig!.mes,
      importe_centimos: r.restoCentimos,
      origen: 'resto' as const,
      estado: 'pendiente' as const,
    }))
  }

  // ── Claim atómico: pendiente → resuelto (evita doble resolución) ──
  const { data: authData } = await supabase.auth.getUser()
  const dbVia = via === 'diferir' ? ('reducir' as const) : ('transferencia' as const)
  const { data: claimed, error: claimErr } = await supabase
    .from('beca_comedor_desborde')
    .update({
      estado: 'resuelto',
      via: dbVia,
      resuelto_por: authData.user?.id ?? null,
      resuelto_at: new Date().toISOString(),
    })
    .eq('id', desborde.id)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle()
  if (claimErr) {
    logger.warn('resolverDesborde claim', claimErr.message)
    if (claimErr.code === '42501') return fail(`${ERR}.no_autorizado`)
    return fail(`${ERR}.save_failed`)
  }
  if (!claimed) return fail(`${ERR}.ya_resuelto`) // USING falso → 0 filas: alguien lo resolvió

  // ── Efecto (idempotente); si falla, revertir el claim a pendiente ──
  const efecto =
    via === 'transferencia'
      ? await aplicarTransferencia(supabase, centroId, desborde)
      : await aplicarDiferir(supabase, centroId, desborde, sig!, restoRows, familiaNinoIds)

  if (efecto.error) {
    await supabase
      .from('beca_comedor_desborde')
      .update({ estado: 'pendiente', via: null, resuelto_por: null, resuelto_at: null })
      .eq('id', desborde.id)
    logger.warn('resolverDesborde efecto', efecto.error)
    return fail(efecto.key ?? `${ERR}.save_failed`)
  }

  revalidatePath(RUTA, 'page')
  return ok({ via, n: efecto.n })
}

/**
 * Vía transferencia: fila por familia con importe = exceso. Un INSERT: el claim de arriba ya impide
 * resolver dos veces. Sin origen, la fila es de beca (el DEFAULT), también antes de PR-1c.
 */
async function aplicarTransferencia(
  supabase: Supa,
  centroId: string,
  desborde: {
    recibo_id: string
    familia_id: string
    anio: number
    mes: number
    exceso_centimos: number
  }
): Promise<{ error?: string; key?: string; n: number }> {
  const { error } = await supabase.from('beca_comedor_transferencia').insert({
    centro_id: centroId,
    recibo_id: desborde.recibo_id,
    familia_id: desborde.familia_id,
    anio: desborde.anio,
    mes: desborde.mes,
    importe_centimos: desborde.exceso_centimos,
    estado: 'pendiente',
  })
  if (error) {
    return {
      error: error.message,
      key: error.code === '42501' ? `${ERR}.no_autorizado` : undefined,
      n: 0,
    }
  }
  return { n: 1 }
}

/** Vía diferir: borra restos previos de la misma firma (idempotencia) e inserta los nuevos. */
async function aplicarDiferir(
  supabase: Supa,
  centroId: string,
  desborde: { anio: number; mes: number },
  sig: { anio: number; mes: number },
  restoRows: Database['public']['Tables']['beca_comedor_tramo']['Insert'][],
  familiaNinoIds: string[]
): Promise<{ error?: string; key?: string; n: number }> {
  // Restos previos de ESTE desborde (firma corr M → aplic M+1) por si es un reintento o una
  // re-resolución tras regenerar. Se barre por TODOS los hijos activos de la familia (no solo
  // los del reparto actual): así el resto de un hijo que perdió la beca entre resoluciones no
  // queda colgado en M+1.
  await supabase
    .from('beca_comedor_tramo')
    .delete()
    .eq('centro_id', centroId)
    .eq('origen', 'resto')
    .eq('anio_correspondiente', desborde.anio)
    .eq('mes_correspondiente', desborde.mes)
    .eq('anio_aplicacion', sig.anio)
    .eq('mes_aplicacion', sig.mes)
    .in('nino_id', familiaNinoIds)

  const { error } = await supabase.from('beca_comedor_tramo').insert(restoRows)
  if (error) {
    return {
      error: error.message,
      key: error.code === '42501' ? `${ERR}.no_autorizado` : undefined,
      n: 0,
    }
  }
  return { n: restoRows.length }
}
