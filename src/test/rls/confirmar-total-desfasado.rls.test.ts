import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

import { borrarMandatos } from './mandatos-como-postgres'
import { firmarV3 } from './mandato-v3-de-test'
import { insertarRecibos } from './remesa-como-sus-funciones'
import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  datosMandatoV2,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * Un recibo con el total desfasado no se confirma (censo C, decisión de Jose del 2026-11-26: «EL BLOQUEO DE
 * confirmar_recibo VA EN B1… un recibo con el total desfasado no se confirma y lo dice con el HINT»).
 *
 * El total desfasado es el que deja `recalcularTotal` cuando no puede releer las líneas: la línea se guarda y el
 * total se queda como estaba (recalcular-total-no-escribe-cero.rls.test.ts). Hasta este bloqueo, ese recibo se
 * confirmaba y seguía el camino del cobro con el total viejo: la lista de remesables, la remesa, la RPC de la que
 * sale el fichero (`get_mandatos_remesa`) y el importe del adeudo (`prepararRemesa`). Aquí se recorre ese camino
 * con las piezas de la app y la sesión de la admin; todo lo que sigue a la premisa es `expect.soft`, para que el
 * log diga hasta dónde llegó. Contra la base efímera. Fixtures ficticios del 2026-11-26.
 */
const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sesion.actual }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { confirmarRecibo } = await import('@/features/recibos/actions/confirmar-recibo')
const { getRecibosSepaRemesables } =
  await import('@/features/remesas/queries/get-recibos-sepa-remesables')
const { crearRemesa } = await import('@/features/remesas/actions/crear-remesa')
const { prepararRemesa } = await import('@/features/remesas/lib/preparar-remesa')

// Un mes futuro, sin recibos del motor.
const ANIO = 2027
const MES = 7
const IBAN = 'ES7620770024003102575766'
const ACREEDOR = {
  identificador_acreedor: 'ES00ZZZ00000000000',
  bic_acreedor: 'CAIXESBBXXX',
  iban: 'ES9121000418450200051332',
}

describe('confirmar_recibo: un recibo con el total desfasado no se confirma', () => {
  let centro: TestCentro
  let admin: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let familia: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Total Desfasado')
    admin = await createTestUser({ nombre: 'Admin Total Desfasado' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    familia = await createTestFamilia(centro.id)
    tutor = await createTestUser({ nombre: 'Tutor Total Desfasado' })
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    const { error } = await firmarV3(await clientFor(tutor), 'registrar_mandato_sepa', {
      p_familia_id: familia,
      p_nino_id: null as unknown as string,
      p_iban: IBAN,
      p_titular: 'Tutor Total Desfasado',
      p_identificador_mandato: 'NIDO-DESF-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Tutor Total Desfasado',
      p_texto_hash: 'a'.repeat(64),
      ...datosMandatoV2(centro),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-11-01T10:00:00Z',
    })
    if (error) throw new Error(`mandato: ${error.message}`)
    sesion.actual = cAdmin
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    if (admin) await deleteTestUser(admin.id)
    if (tutor) await deleteTestUser(tutor.id)
  }, 120_000)

  beforeEach(async () => {
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
  })

  /** El borrador regular SEPA de la familia con líneas de 50 € y 10 €, y el total que se le diga. */
  async function borrador(total: number): Promise<string> {
    const [id] = await insertarRecibos([
      {
        centro_id: centro.id,
        familia_id: familia,
        anio: ANIO,
        mes: MES,
        metodo: 'sepa',
        estado: 'borrador',
        total_centimos: total,
        es_esporadico: false,
      },
    ])
    const l = await serviceClient.from('lineas_recibo').insert(
      [5000, 1000].map((importe, i) => ({
        centro_id: centro.id,
        recibo_id: id,
        descripcion: `Línea de prueba ${i + 1}`,
        cantidad: 1,
        precio_unitario_centimos: importe,
        importe_centimos: importe,
        origen: 'manual' as const,
      }))
    )
    if (l.error) throw new Error(`líneas: ${l.error.message}`)
    return id
  }

  async function estado(id: string) {
    const { data, error } = await serviceClient
      .from('recibos')
      .select('estado, total_centimos')
      .eq('id', id)
      .single()
    if (error) throw new Error(`leer el recibo: ${error.message}`)
    return data
  }

  async function sumaLineas(id: string) {
    const { data, error } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos')
      .eq('recibo_id', id)
    if (error) throw new Error(`leer las líneas: ${error.message}`)
    return data.reduce((a, l) => a + l.importe_centimos, 0)
  }

  it('control: un recibo con el total al día se confirma', async () => {
    const id = await borrador(6000)
    expect(await sumaLineas(id), 'premisa: el total es la suma de las líneas').toBe(6000)
    const r = await confirmarRecibo(id)
    expect(r.success).toBe(true)
    expect((await estado(id)).estado).toBe('pendiente_procesar')
  })

  it('con el total desfasado: no se confirma, lo dice, y no llega a la remesa', async () => {
    const id = await borrador(5000)
    expect(await sumaLineas(id), 'premisa: las líneas suman 60 €').toBe(6000)
    expect(await estado(id), 'premisa: borrador con un total de 50 €').toEqual({
      estado: 'borrador',
      total_centimos: 5000,
    })

    // 1. Confirmar.
    const r = await confirmarRecibo(id)
    expect.soft(r, 'confirmar: no, y dice por qué').toEqual({
      success: false,
      error: 'recibos_panel.errors.total_desfasado',
    })
    expect.soft((await estado(id)).estado, 'el recibo sigue en borrador').toBe('borrador')

    // 2. La lista de remesables de la directora.
    const remesables = await getRecibosSepaRemesables(centro.id, ANIO, MES)
    const enLista = remesables.find((x) => x.id === id)
    expect.soft(enLista, 'no sale entre los remesables').toBeUndefined()

    // 3. La remesa con ese recibo, y lo que lee el fichero.
    const remesa = await crearRemesa({ anio: ANIO, mes: MES, reciboIds: [id] }, centro.id)
    let filas: Array<{ recibo_id: string; total_centimos: number }> = []
    let importes: number[] = []
    if (remesa.success) {
      const { data, error } = await cAdmin.rpc('get_mandatos_remesa', {
        p_remesa_id: remesa.data.remesaId,
      })
      if (error) throw new Error(`get_mandatos_remesa: ${error.message}`)
      filas = (data ?? []).map((f) => ({
        recibo_id: f.recibo_id,
        total_centimos: f.total_centimos,
      }))
      const res = prepararRemesa(
        data ?? [],
        ACREEDOR,
        {
          messageId: 'NIDO-TEST-DESFASADO',
          creationDateTime: '2027-07-01T12:00:00',
          fechaPorDefecto: '2027-07-05',
          creditorName: centro.nombre,
          sequenceType: 'RCUR',
        },
        new Map((data ?? []).map((f) => [f.recibo_id, 'Cuota de prueba'])),
        new Map((data ?? []).map((f) => [f.recibo_id, null]))
      )
      importes = res.ok ? res.adeudos.map((a) => a.importe_centimos) : []
    }
    expect.soft(filas, 'el fichero no lo lee').toEqual([])
    expect.soft(importes, 'ningún adeudo de este recibo (las líneas suman 6000)').toEqual([])
  })
})
