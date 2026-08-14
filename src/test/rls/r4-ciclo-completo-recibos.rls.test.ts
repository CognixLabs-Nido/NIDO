import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'
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
 * R-4 — CICLO COMPLETO de recibos, de punta a punta.
 *
 * Test de INTEGRACIÓN: reproduce el escenario real que originó toda la serie, en orden y
 * sobre la misma familia, en vez de comprobar cada pieza por separado. Los `it` comparten
 * estado a propósito y se leen como una historia; cada uno depende del anterior.
 *
 * El hueco que cierra: NADIE probaba la CADENA de R-1 (`proponer_asignaciones` seguido de
 * `generar_recibos_mes`), que es justo la premisa del botón "Recalcular el mes". Los tests
 * de R-1 son puros (el compositor del aviso y las claves i18n); F42/D5 prueban `proponer`
 * aislado y nunca generan recibos; F43 y la suite de R-2 generan recibos y nunca siembran.
 * El bug de Jose vivía exactamente en esa junta.
 *
 * NO duplica lo ya cubierto, que se referencia donde toca:
 *   · mecánica del motor (mensual/diario/override/vigencia/becas/hermanos/saldo/descarte/
 *     idempotencia), `confirmar_recibo` y el congelado por estado → `f43-motor-recibos-familia`.
 *   · que la manual sobreviva, el recibo solo-manual, el desborde sin 23505, el tope con C1,
 *     las dos bases del PASE 3 y la equivalencia en automático puro → `r2-motor-preserva-manuales`.
 *   · siembra de `proponer_asignaciones` y respeto de la baja manual → `f42`/`d5`.
 *   · composición del aviso del botón → `resumen-recalculo.test.ts` (unit).
 * Aquí esas garantías se comprueban EN CONTEXTO, dentro del ciclo, no en aislamiento.
 *
 * Gateado: R2_MIGRATION_APPLIED=1 (el ciclo necesita `origen` y el motor de R-2).
 */

const APPLIED = process.env.R2_MIGRATION_APPLIED === '1'

type AsignacionInsert = Database['public']['Tables']['asignacion_concepto']['Insert']
type LineaInsert = Database['public']['Tables']['lineas_recibo']['Insert']

const ANIO = 2026
const MES = 5

const ESCOLARIDAD = 50000
const BECA = 40000

interface LineaFila {
  id: string
  nino_id: string | null
  concepto_id: string | null
  descripcion: string
  importe_centimos: number
  origen: string
}

describe.skipIf(!APPLIED)('R-4 — ciclo completo de recibos (integración)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>

  // El catálogo del centro: los dos conceptos automáticos y el descuento de hermanos.
  let escolaridadId: string
  let hermanosId: string

  // Los protagonistas. `garrido` llega a tiempo; `gonzalez` y `jaime` son las altas tardías.
  let famGarrido: string
  let famGonzalez: string
  let ninoJaime: string
  let ninoGonzalez: string

  let reciboGonzalezId: string
  let lineaManualId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro R4 ciclo')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin R4' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  })

  afterAll(async () => {
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

  // ── utilidades del ciclo ────────────────────────────────────────────────────

  async function nuevoNino(familiaId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'R4',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nuevoNino ${nombre}: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    return data.id
  }

  /** El botón "Recalcular el mes" de R-1: sembrar conceptos y acto seguido regenerar. */
  async function recalcularElMes() {
    const sembrado = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
    expect(sembrado.error).toBeNull()
    const generado = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(generado.error).toBeNull()
    return { sembradas: sembrado.data as number, generados: generado.data as number }
  }

  /** Solo regenerar, SIN sembrar: lo que hacía el botón viejo de generar. */
  async function soloGenerar() {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(error).toBeNull()
  }

  async function recibo(familiaId: string) {
    const { data: r } = await serviceClient
      .from('recibos')
      .select('id, estado, total_centimos')
      .eq('familia_id', familiaId)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('es_esporadico', false)
      .is('devuelto_de_recibo_id', null)
      .is('deleted_at', null)
      .maybeSingle()
    if (!r) return { recibo: null, lineas: [] as LineaFila[] }
    const { data: l } = await serviceClient
      .from('lineas_recibo')
      .select('id, nino_id, concepto_id, descripcion, importe_centimos, origen')
      .eq('recibo_id', r.id)
    return { recibo: r, lineas: (l ?? []) as LineaFila[] }
  }

  // ── el ciclo ────────────────────────────────────────────────────────────────

  it('1 · arranque: el centro tiene su catálogo y una familia ya matriculada y facturada', async () => {
    const { data: esc } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'R4 Escolaridad',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        aplicacion: 'automatico',
        importe_centimos: ESCOLARIDAD,
      })
      .select('id')
      .single()
    escolaridadId = esc!.id

    await serviceClient.from('conceptos_cobro').insert({
      centro_id: centro.id,
      nombre: 'R4 Beca Conselleria',
      tipo_concepto: 'mensual',
      tipo_valor: 'fijo',
      signo: -1,
      ambito: 'nino',
      aplicacion: 'automatico',
      importe_centimos: BECA,
    })

    // Descuento de hermanos: sirve para comprobar EN EL CICLO que una línea manual no lo
    // mueve (decisión A). Manual para que `proponer` no lo siembre solo.
    const { data: her } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'R4 Hermanos',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: -1,
        ambito: 'familia',
        aplicacion: 'manual',
        importe_centimos: 5000,
      })
      .select('id')
      .single()
    hermanosId = her!.id

    famGarrido = await createTestFamilia(centro.id)
    await nuevoNino(famGarrido, 'Pepe')

    // La ÚLTIMA siembra del centro ocurre aquí: Pepe entra en ella, los que lleguen
    // después no. Es exactamente la situación que dejó a Gonzalez sin cargos.
    const { sembradas } = await recalcularElMes()
    expect(sembradas).toBeGreaterThan(0)

    const garrido = await recibo(famGarrido)
    expect(garrido.recibo).not.toBeNull()
    expect(garrido.recibo!.total_centimos).toBe(ESCOLARIDAD - BECA)
  })

  it('2 · alta tardía: los recién matriculados nacen SIN conceptos → uno desaparece y el otro infrafactura', async () => {
    famGonzalez = await createTestFamilia(centro.id)
    ninoGonzalez = await nuevoNino(famGonzalez, 'Gonzalez')
    ninoJaime = await nuevoNino(famGarrido, 'Jaime')

    // Regenerar SIN sembrar: es lo que hacía la directora con el botón de generar.
    await soloGenerar()

    // Gonzalez: sin conceptos no tiene ninguna línea, y el motor descarta el recibo vacío.
    // En el panel esto es la fila "Sin cargos" — la familia desaparece.
    const gonzalez = await recibo(famGonzalez)
    expect(gonzalez.recibo, 'Gonzalez no debería tener recibo todavía').toBeNull()

    // Jaime es peor: no desaparece nada, simplemente no aporta y el recibo familiar cobra
    // de menos EN SILENCIO. Sigue valiendo lo de un solo hijo.
    const garrido = await recibo(famGarrido)
    expect(garrido.recibo!.total_centimos).toBe(ESCOLARIDAD - BECA)
    expect(garrido.lineas.some((l) => l.nino_id === ninoJaime)).toBe(false)
  })

  it('3 · "Recalcular el mes" (R-1): Gonzalez reaparece y Jaime deja de infrafacturar', async () => {
    const { sembradas, generados } = await recalcularElMes()

    // 2 conceptos automáticos × 2 niños nuevos. Que la cifra sea >0 es lo que el aviso
    // honesto de R-1 traduce a "N conceptos sembrados a M niños".
    expect(sembradas).toBe(4)
    expect(generados).toBeGreaterThan(0)

    const gonzalez = await recibo(famGonzalez)
    expect(gonzalez.recibo, 'Gonzalez sigue sin recibo tras recalcular').not.toBeNull()
    expect(gonzalez.recibo!.total_centimos).toBe(ESCOLARIDAD - BECA)
    reciboGonzalezId = gonzalez.recibo!.id

    const garrido = await recibo(famGarrido)
    expect(garrido.lineas.some((l) => l.nino_id === ninoJaime)).toBe(true)
    expect(garrido.recibo!.total_centimos).toBe(2 * (ESCOLARIDAD - BECA))
  })

  it('4 · edición manual (R-3): añadir línea sube el total; editar una automática la vuelve manual (B1)', async () => {
    const antes = await recibo(famGonzalez)

    // Lo que hace `anadirLineaRecibo`: la línea NACE manual.
    const { data: nueva, error: errNueva } = await cAdmin
      .from('lineas_recibo')
      .insert({
        centro_id: centro.id,
        recibo_id: reciboGonzalezId,
        nino_id: ninoGonzalez,
        descripcion: 'Material a mano',
        cantidad: 1,
        precio_unitario_centimos: 7500,
        importe_centimos: 7500,
        origen: 'manual',
      } as LineaInsert)
      .select('id')
      .single()
    expect(errNueva).toBeNull()
    lineaManualId = nueva!.id

    // Lo que hace `editarLineaRecibo`: cambia el importe Y convierte a manual (B1).
    const automatica = antes.lineas.find((l) => l.concepto_id === escolaridadId)!
    const { error: errEdit } = await cAdmin
      .from('lineas_recibo')
      .update({
        descripcion: 'Escolaridad pactada',
        precio_unitario_centimos: 30000,
        importe_centimos: 30000,
        origen: 'manual',
      })
      .eq('id', automatica.id)
    expect(errEdit).toBeNull()

    const tras = await recibo(famGonzalez)
    expect(tras.lineas.filter((l) => l.origen === 'manual')).toHaveLength(2)
  })

  it('5 · regenerar: lo tocado a mano sobrevive (R-2) y lo automático se recalcula', async () => {
    await recalcularElMes()

    const tras = await recibo(famGonzalez)
    expect(tras.recibo!.id, 'el recibo se recreó y perdió las manuales').toBe(reciboGonzalezId)

    const manuales = tras.lineas.filter((l) => l.origen === 'manual')
    expect(manuales).toHaveLength(2)
    expect(manuales.find((l) => l.id === lineaManualId)!.importe_centimos).toBe(7500)
    expect(manuales.find((l) => l.descripcion === 'Escolaridad pactada')!.importe_centimos).toBe(
      30000
    )

    // La escolaridad automática VUELVE: convertir la línea a manual no desasigna el
    // concepto, solo deja de ser esa fila. El total lo refleja.
    const automaticas = tras.lineas.filter((l) => l.origen === 'automatico')
    expect(automaticas.some((l) => l.concepto_id === escolaridadId)).toBe(true)
    expect(tras.recibo!.total_centimos).toBe(7500 + 30000 + ESCOLARIDAD - BECA)
  })

  it('6 · en contexto: el descuento de hermanos NO se mueve por un cargo manual (decisión A)', async () => {
    await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      concepto_id: hermanosId,
      familia_id: famGarrido,
      origen: 'manual',
    } as AsignacionInsert)

    await recalcularElMes()
    const antes = await recibo(famGarrido)
    const beneficiario = antes.lineas.find((l) => l.concepto_id === hermanosId)!.nino_id
    expect(beneficiario).not.toBeNull()

    // Cargo gordo a mano al hermano que HOY recibe el descuento: sin el filtro de la
    // decisión A pasaría a ser "el que más paga" y el descuento saltaría al otro.
    await cAdmin.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: antes.recibo!.id,
      nino_id: beneficiario,
      descripcion: 'Cargo manual gordo',
      cantidad: 1,
      precio_unitario_centimos: 400000,
      importe_centimos: 400000,
      origen: 'manual',
    } as LineaInsert)

    await recalcularElMes()
    const despues = await recibo(famGarrido)
    expect(despues.lineas.find((l) => l.concepto_id === hermanosId)!.nino_id).toBe(beneficiario)
  })

  it('7 · en contexto: la beca comedor desborda sin reventar y su tope cuenta las manuales (C1)', async () => {
    await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: ninoGonzalez,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: MES,
      anio_aplicacion: ANIO,
      mes_aplicacion: MES,
      importe_centimos: 200000,
      estado: 'pendiente',
    })

    // Dos pasadas seguidas: la 2.ª es la que moría con 23505 antes del borrado explícito
    // del desborde. Aquí ocurre dentro del ciclo, con manuales ya en el recibo.
    await recalcularElMes()
    await recalcularElMes()

    const { data: desbordes } = await serviceClient
      .from('beca_comedor_desborde')
      .select('cuota_total_centimos')
      .eq('familia_id', famGonzalez)
    expect(desbordes ?? [], 'el desborde se duplicó o no se creó').toHaveLength(1)

    // C1: la base del tope suma el recibo entero, manuales incluidas. Sin C1 sería solo
    // lo automático (100 €); con las dos manuales (75 + 300 €) la cuota disponible sube.
    expect(desbordes![0]!.cuota_total_centimos).toBe(7500 + 30000 + ESCOLARIDAD - BECA)
  })

  it('8 · confirmar: el recibo queda congelado y editarlo devuelve error limpio, no un crash', async () => {
    const { error } = await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboGonzalezId })
    expect(error).toBeNull()

    const confirmado = await recibo(famGonzalez)
    expect(confirmado.recibo!.estado).not.toBe('borrador')
    const totalCongelado = confirmado.recibo!.total_centimos

    // El trigger de congelado responde con P0001; la action lo traduce a un mensaje. Lo
    // que importa aquí es que la BD RECHAZA y devuelve error, en vez de dejar pasar.
    const intento = await cAdmin
      .from('lineas_recibo')
      .update({ importe_centimos: 1 })
      .eq('id', lineaManualId)
      .select('id')
    expect(intento.error, 'se pudo editar una línea de un recibo confirmado').not.toBeNull()

    const intentoAnadir = await cAdmin
      .from('lineas_recibo')
      .insert({
        centro_id: centro.id,
        recibo_id: reciboGonzalezId,
        descripcion: 'no deberia entrar',
        cantidad: 1,
        precio_unitario_centimos: 100,
        importe_centimos: 100,
        origen: 'manual',
      } as LineaInsert)
      .select('id')
    expect(intentoAnadir.error).not.toBeNull()

    // Y el ciclo se cierra: recalcular otra vez no toca el confirmado.
    await recalcularElMes()
    const tras = await recibo(famGonzalez)
    expect(tras.recibo!.id).toBe(reciboGonzalezId)
    expect(tras.recibo!.total_centimos).toBe(totalCongelado)
  })
})
