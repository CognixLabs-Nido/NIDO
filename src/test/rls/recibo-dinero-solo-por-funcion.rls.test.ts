import { execFileSync } from 'node:child_process'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'
import { pasarAEnviadoComoMarcar, insertarRecibos } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * El recibo y su dinero (`20261222120000`, decisiones A y B del responsable del 2026-11-02), contra
 * la BD real. Trigger `recibos_dinero_solo_por_funcion`, para todos, también service_role:
 *
 *  - A. Un recibo solo entra en `enviado_banco` por `marcar_remesa_enviada`, recibo a recibo con el
 *    marcador `app.marcar_recibo_enviado` = su id (`enviado_solo_por_marcar`). Ni UPDATE ni INSERT
 *    directos, desde ningún estado.
 *  - B. Un hecho de dinero no se deshace por fuera (`hecho_de_dinero`): de `cobrado_manual` no se
 *    sale, y de `enviado_banco` solo a `devuelto`, que es la devolución que anota Dirección.
 *
 * Los casos de service_role y de un esporádico separan este trigger del congelado
 * (`congelar_si_mes_cerrado`), que exime a service_role y no mira los esporádicos.
 */

type Insert = Database['public']['Tables']['recibos']['Insert']

describe('El recibo y su dinero: solo por sus funciones', () => {
  let centro: { id: string }
  let familia: string
  let directora: TestUser
  let tutor: TestUser
  let cDirectora: SupabaseClient<Database>
  let mes = 4

  async function recibo(over: Partial<Insert> = {}): Promise<string> {
    const [id] = await insertarRecibos([
      {
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 5,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Dinero por función',
        ...over,
      },
    ])
    return id
  }

  async function enviado(over: Partial<Insert> = {}): Promise<string> {
    const id = await recibo(over)
    pasarAEnviadoComoMarcar([id], '2026-05-05')
    return id
  }

  async function cobrado(over: Partial<Insert> = {}): Promise<string> {
    return recibo({
      metodo: 'efectivo',
      estado: 'cobrado_manual',
      cobro_forma: 'efectivo',
      cobro_fecha: '2026-05-06',
      ...over,
    })
  }

  async function estadoDe(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select('estado, fecha_envio_banco')
      .eq('id', id)
      .single()
    return data
  }

  function insertarEnEnviado(c: SupabaseClient<Database>) {
    return c.from('recibos').insert({
      centro_id: centro.id,
      familia_id: familia,
      anio: 2026,
      mes: 5,
      estado: 'enviado_banco',
      fecha_envio_banco: '2026-05-05',
      metodo: 'sepa',
      total_centimos: 10000,
      es_esporadico: true,
      concepto_esporadico: 'Insert en enviado',
    })
  }

  const A_ENVIADO = { estado: 'enviado_banco' as const, fecha_envio_banco: '2026-05-05' }
  const SIN_COBRO = { cobro_forma: null, cobro_fecha: null, cobro_nota: null }

  beforeAll(async () => {
    centro = await createTestCentro('Dinero por función')
    directora = await createTestUser({ nombre: 'Directora Dinero' })
    tutor = await createTestUser({ nombre: 'Tutora Dinero' })
    await asignarRol(directora.id, centro.id, 'directora')
    familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cDirectora = await clientFor(directora)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestUser(tutor.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('el recibo pasa a enviado como lo pasa marcar_remesa_enviada, con su marcador', async () => {
    const id = await recibo()
    expect(await estadoDe(id)).toEqual({ estado: 'pendiente_procesar', fecha_envio_banco: null })
    pasarAEnviadoComoMarcar([id], '2026-05-05')
    expect(await estadoDe(id)).toEqual(A_ENVIADO)
  })

  it('A · la sesión no lo pasa a enviado por fuera, desde ningún estado, ni lo crea así', async () => {
    const pendiente = await recibo()
    const borrador = await recibo({ estado: 'borrador' })
    const cobradoManual = await cobrado()
    expect((await estadoDe(borrador))?.estado).toBe('borrador')
    expect((await estadoDe(cobradoManual))?.estado).toBe('cobrado_manual')
    for (const [id, set] of [
      [pendiente, A_ENVIADO],
      [borrador, A_ENVIADO],
      [cobradoManual, { ...A_ENVIADO, ...SIN_COBRO }],
    ] as const) {
      const { error } = await cDirectora.from('recibos').update(set).eq('id', id)
      expect(error?.hint).toBe('enviado_solo_por_marcar')
    }
    expect((await estadoDe(pendiente))?.estado).toBe('pendiente_procesar')
    expect((await insertarEnEnviado(cDirectora)).error?.hint).toBe('enviado_solo_por_marcar')
  })

  it('A · service_role tampoco, ni por UPDATE ni por INSERT', async () => {
    const pendiente = await recibo()
    const { error } = await serviceClient.from('recibos').update(A_ENVIADO).eq('id', pendiente)
    expect(error?.hint).toBe('enviado_solo_por_marcar')
    expect((await insertarEnEnviado(serviceClient)).error?.hint).toBe('enviado_solo_por_marcar')
    expect((await estadoDe(pendiente))?.estado).toBe('pendiente_procesar')
  })

  it('A · el marcador de otro recibo no vale, tampoco como postgres', async () => {
    const otro = await recibo()
    const este = await recibo()
    const url = process.env.DB_URL
    if (!url) throw new Error('DB_URL: solo en la BD efímera del CI')
    const sql = [
      'BEGIN;',
      `SELECT set_config('app.marcar_recibo_enviado', '${otro}', true);`,
      `UPDATE public.recibos SET estado = 'enviado_banco', fecha_envio_banco = '2026-05-05' WHERE id = '${este}';`,
      'COMMIT;',
    ].join('\n')
    let fallo = ''
    try {
      execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e) {
      fallo = String((e as { stderr?: string }).stderr ?? e)
    }
    expect(fallo).toContain('enviado_solo_por_marcar')
    expect((await estadoDe(este))?.estado).toBe('pendiente_procesar')
  })

  it('B · la sesión no devuelve un enviado a pendiente ni a borrador', async () => {
    const enviadoEsporadico = await enviado()
    for (const set of [
      { estado: 'pendiente_procesar' as const, fecha_envio_banco: null },
      { estado: 'borrador' as const, fecha_envio_banco: null },
    ]) {
      const { error } = await cDirectora.from('recibos').update(set).eq('id', enviadoEsporadico)
      expect(error?.hint).toBe('hecho_de_dinero')
    }
    expect(await estadoDe(enviadoEsporadico)).toEqual(A_ENVIADO)
  })

  it('B · service_role tampoco, también con un regular (el congelado le exime)', async () => {
    mes += 1
    const regular = await enviado({ es_esporadico: false, concepto_esporadico: null, mes })
    for (const set of [
      { estado: 'pendiente_procesar' as const, fecha_envio_banco: null },
      { estado: 'borrador' as const, fecha_envio_banco: null },
    ]) {
      const { error } = await serviceClient.from('recibos').update(set).eq('id', regular)
      expect(error?.hint).toBe('hecho_de_dinero')
    }
    expect(await estadoDe(regular)).toEqual(A_ENVIADO)
  })

  it('B · un cobrado a mano no sale de cobrado_manual, ni con la sesión ni con service_role', async () => {
    const id = await cobrado()
    for (const [c, set] of [
      [cDirectora, { estado: 'pendiente_procesar' as const, ...SIN_COBRO }],
      [cDirectora, { estado: 'borrador' as const, ...SIN_COBRO }],
      [
        cDirectora,
        {
          estado: 'devuelto' as const,
          fecha_envio_banco: '2026-05-01',
          fecha_devolucion: '2026-05-10',
          devolucion_gastos_centimos: 0,
          ...SIN_COBRO,
        },
      ],
      [serviceClient, { estado: 'pendiente_procesar' as const, ...SIN_COBRO }],
    ] as const) {
      const { error } = await c.from('recibos').update(set).eq('id', id)
      expect(error?.hint).toBe('hecho_de_dinero')
    }
    expect((await estadoDe(id))?.estado).toBe('cobrado_manual')
  })

  // B no cierra la salida legítima de enviado_banco: la devolución. Desde 20261223120000 (C) se
  // anota con marcar_recibo_devuelto; el UPDATE directo que usaba este test ya no pasa.
  it('lo legítimo sigue: un enviado se devuelve, con su función (lo que anota Dirección)', async () => {
    const id = await enviado()
    const { error } = await cDirectora.rpc('marcar_recibo_devuelto', {
      p_recibo_id: id,
      p_fecha: '2026-05-10',
      p_gastos_centimos: 0,
    })
    expect(error).toBeNull()
    expect((await estadoDe(id))?.estado).toBe('devuelto')
  })
})
