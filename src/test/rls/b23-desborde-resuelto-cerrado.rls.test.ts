import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * B2-3 — un desborde de beca comedor RESUELTO queda CERRADO.
 *
 * El reset del motor borraba `beca_comedor_desborde` de todo borrador SIN mirar su estado, y
 * PASE 2-bis lo reinsertaba pendiente. Un desborde ya resuelto renacía pendiente en cada
 * recálculo: el EFECTO sobrevivía (la transferencia hecha, los tramos `resto` aplicándose en
 * el mes siguiente) y el REGISTRO de la resolución desaparecía. La directora volvía a ver
 * pendiente algo ya pagado, y resolverlo otra vez significaba pagar dos veces.
 *
 * Decisión de Jose: cerrado es cerrado. Un resuelto no se borra ni se recalcula nunca más;
 * solo se recalculan los PENDIENTES.
 *
 * Lo que fija esta suite:
 *   1. resuelto por TRANSFERENCIA sobrevive a dos regeneraciones, con el MISMO id, y su
 *      fila de `beca_comedor_transferencia` sigue vinculada;
 *   2. resuelto DIFIRIENDO al mes siguiente sobrevive igual, con sus tramos `resto` intactos;
 *   3. un PENDIENTE se sigue recalculando de verdad (no congela de más);
 *   4. en los tres, UNA sola fila por recibo → el 23505 que R-2 cerró no reaparece.
 *
 * UN MES POR TEST: confirmar no interviene aquí, pero cada `it` estrena mes igualmente para
 * que ninguno herede el estado del anterior (lección de R-5).
 *
 * Gateado: B23_MIGRATION_APPLIED=1 (requiere
 * `20260829120000_phase_beca_b2_3_desborde_resuelto_cerrado`).
 */

const APPLIED = process.env.B23_MIGRATION_APPLIED === '1'

const ANIO = 2026
const ESCOLARIDAD = 50000
/** Beca muy por encima de la cuota → desborde garantizado. */
const BECA = 900000

let mesLibre = 2
function siguienteMes(): number {
  mesLibre += 1
  return mesLibre
}

interface Caso {
  familiaId: string
  ninoId: string
  reciboId: string
  desbordeId: string
  excesoCentimos: number
  mes: number
}

describe.skipIf(!APPLIED)('B2-3 — un desborde resuelto queda cerrado', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let conceptoId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro B23 desborde')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin B23' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)

    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'B23 Escolaridad',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        importe_centimos: ESCOLARIDAD,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    conceptoId = data.id
  })

  afterAll(async () => {
    await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  async function generar(mes: number): Promise<void> {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: mes,
    })
    if (error) throw new Error(`generar (mes ${mes}): ${error.message}`)
  }

  /** Familia con un hijo becado por encima de su cuota → recibo con desborde PENDIENTE. */
  async function familiaConDesborde(nombre: string): Promise<Caso> {
    const mes = siguienteMes()
    const familiaId = await createTestFamilia(centro.id)

    const { data: nino, error: errNino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'B23',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (errNino || !nino) throw new Error(`fixture nino: ${errNino?.message}`)
    await matricular(nino.id, aula.id, curso.id)

    const { error: errAsig } = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, concepto_id: conceptoId, nino_id: nino.id, origen: 'manual' })
    if (errAsig) throw new Error(`fixture asignacion: ${errAsig.message}`)

    const { error: errTramo } = await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: nino.id,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: mes,
      anio_aplicacion: ANIO,
      mes_aplicacion: mes,
      importe_centimos: BECA,
      estado: 'pendiente',
      origen: 'normal',
    })
    if (errTramo) throw new Error(`fixture tramo: ${errTramo.message}`)

    await generar(mes)

    const { data: desborde, error } = await serviceClient
      .from('beca_comedor_desborde')
      .select('id, recibo_id, exceso_centimos, estado')
      .eq('centro_id', centro.id)
      .eq('familia_id', familiaId)
      .eq('anio', ANIO)
      .eq('mes', mes)
      .single()
    if (error || !desborde) throw new Error(`fixture desborde: ${error?.message}`)
    expect(desborde.estado, 'el desborde debería nacer pendiente').toBe('pendiente')

    return {
      familiaId,
      ninoId: nino.id,
      reciboId: desborde.recibo_id,
      desbordeId: desborde.id,
      excesoCentimos: desborde.exceso_centimos,
      mes,
    }
  }

  /** Marca el desborde como resuelto, como hace `resolverDesborde()`. */
  async function marcarResuelto(id: string, via: 'transferencia' | 'reducir'): Promise<void> {
    const { error } = await serviceClient
      .from('beca_comedor_desborde')
      .update({ estado: 'resuelto', via, resuelto_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(`marcarResuelto: ${error.message}`)
  }

  /** La fila del desborde de un recibo, más cuántas hay (el UNIQUE dice que como mucho 1). */
  async function desbordeDe(reciboId: string) {
    const { data } = await serviceClient
      .from('beca_comedor_desborde')
      .select('id, estado, via, exceso_centimos')
      .eq('recibo_id', reciboId)
    return { filas: data ?? [], fila: (data ?? [])[0] }
  }

  /** La línea familiar de ajuste que el motor escribe cuando la beca desborda. */
  async function etiquetaAjuste(reciboId: string): Promise<string | null> {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('descripcion')
      .eq('recibo_id', reciboId)
      .like('descripcion', 'Ajuste beca%')
      .maybeSingle()
    return data?.descripcion ?? null
  }

  it('resuelto por TRANSFERENCIA: sobrevive a dos regeneraciones con el mismo id', async () => {
    const caso = await familiaConDesborde('Transf')
    expect(await etiquetaAjuste(caso.reciboId)).toBe('Ajuste beca comedor (pendiente)')

    await marcarResuelto(caso.desbordeId, 'transferencia')
    const { error: errTransf } = await serviceClient.from('beca_comedor_transferencia').insert({
      centro_id: centro.id,
      recibo_id: caso.reciboId,
      familia_id: caso.familiaId,
      anio: ANIO,
      mes: caso.mes,
      importe_centimos: caso.excesoCentimos,
      estado: 'pendiente',
    })
    if (errTransf) throw new Error(`fixture transferencia: ${errTransf.message}`)

    // Dos vueltas: la 2.ª es la que reventaba con 23505 antes de R-2, y la que ahora
    // podría reventar de nuevo si el guard del INSERT no estuviera.
    await generar(caso.mes)
    await generar(caso.mes)

    const { filas, fila } = await desbordeDe(caso.reciboId)
    expect(filas, 'UNIQUE(recibo_id): nunca dos filas').toHaveLength(1)
    expect(fila!.id, 'el desborde se recreó: se perdió quién y cuándo lo resolvió').toBe(
      caso.desbordeId
    )
    expect(fila).toMatchObject({ estado: 'resuelto', via: 'transferencia' })
    expect(fila!.exceso_centimos).toBe(caso.excesoCentimos)

    // La transferencia sigue colgando del mismo recibo: la resolución no se ha quedado huérfana.
    const { data: transferencias } = await serviceClient
      .from('beca_comedor_transferencia')
      .select('id, importe_centimos')
      .eq('recibo_id', caso.reciboId)
    expect(transferencias).toHaveLength(1)
    expect(transferencias![0]!.importe_centimos).toBe(caso.excesoCentimos)

    // Y la línea deja de mentir: no dice "pendiente" sobre un importe ya transferido.
    expect(await etiquetaAjuste(caso.reciboId)).toBe(
      'Ajuste beca comedor (resuelto por transferencia)'
    )
  })

  it('resuelto DIFIRIENDO al mes siguiente: sobrevive y sus tramos resto quedan intactos', async () => {
    const caso = await familiaConDesborde('Diferido')

    await marcarResuelto(caso.desbordeId, 'reducir')
    // El efecto del diferido: tramos `resto` que se aplican en el MES SIGUIENTE.
    const { error: errResto } = await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: caso.ninoId,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: caso.mes,
      anio_aplicacion: ANIO,
      mes_aplicacion: caso.mes + 1,
      importe_centimos: caso.excesoCentimos,
      estado: 'pendiente',
      origen: 'resto',
    })
    if (errResto) throw new Error(`fixture resto: ${errResto.message}`)

    await generar(caso.mes)
    await generar(caso.mes)

    const { filas, fila } = await desbordeDe(caso.reciboId)
    expect(filas).toHaveLength(1)
    expect(fila!.id).toBe(caso.desbordeId)
    expect(fila).toMatchObject({ estado: 'resuelto', via: 'reducir' })

    // Regenerar el mes ORIGEN no toca los tramos del mes DESTINO (se aplican por
    // `mes_aplicacion`), así que la resolución sigue en pie por los dos lados.
    const { data: restos } = await serviceClient
      .from('beca_comedor_tramo')
      .select('id, importe_centimos, mes_aplicacion')
      .eq('centro_id', centro.id)
      .eq('origen', 'resto')
      .eq('mes_correspondiente', caso.mes)
    expect(restos).toHaveLength(1)
    expect(restos![0]).toMatchObject({
      importe_centimos: caso.excesoCentimos,
      mes_aplicacion: caso.mes + 1,
    })

    expect(await etiquetaAjuste(caso.reciboId)).toBe(
      'Ajuste beca comedor (resuelto: diferido al mes siguiente)'
    )
  })

  it('un desborde PENDIENTE se sigue recalculando: no se congela de más', async () => {
    const caso = await familiaConDesborde('Pendiente')

    // Un cargo a mano SUBE la cuota → la beca tiene más que descontar → el exceso BAJA.
    // Si el motor hubiera congelado también los pendientes, el exceso no se movería.
    const CARGO = 100000
    const { error } = await serviceClient.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: caso.reciboId,
      descripcion: 'Cargo a mano que sube la cuota',
      cantidad: 1,
      precio_unitario_centimos: CARGO,
      importe_centimos: CARGO,
      origen: 'manual',
    })
    if (error) throw new Error(`fixture cargo: ${error.message}`)

    await generar(caso.mes)

    const { filas, fila } = await desbordeDe(caso.reciboId)
    expect(filas).toHaveLength(1)
    expect(fila!.estado).toBe('pendiente')
    expect(fila!.id, 'un pendiente SÍ se recrea en cada regeneración').not.toBe(caso.desbordeId)
    expect(fila!.exceso_centimos, 'el exceso debería haber bajado por el cargo manual').toBe(
      caso.excesoCentimos - CARGO
    )
    expect(await etiquetaAjuste(caso.reciboId)).toBe('Ajuste beca comedor (pendiente)')
  })
})
