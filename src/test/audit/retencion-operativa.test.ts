import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TABLAS_OPERATIVA } from '@/features/retencion/types'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * La operativa por tiempo (F11-B, punto 6, PR-5; 20261203120000).
 *
 * Cada registro de la operativa se borra cuando ha pasado el plazo desde el final del curso en que
 * se escribió (el primero del centro que termina en su fecha o después), con sus copias en
 * audit_log, y también las copias de lo que se borró antes. La fecha del registro es la más tardía
 * de las suyas: lo que se dio de alta (o se editó, el informe) hace poco no vence aunque su día sea
 * viejo.
 *
 * Lo que vence es de un curso de 1995-96 y la purga real se pide con 20 años: así solo alcanza a
 * lo de este fichero aunque la BD la compartan otros tests.
 */

const ANIOS = 20
const VIEJO = (fecha: string) => `${fecha}T10:00:00+00:00`

interface Fila {
  tabla: string
  id: string
  /** Si la purga se la tiene que llevar. */
  vence: boolean
}

describe('Retención de la operativa', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let admin: TestUser
  let plantilla: string
  let cursoViejo: string
  const filas: Fila[] = []
  /** Copias de filas ya borradas: la que se envejece vence; la reciente se queda. */
  let huerfanaVieja: string
  let huerfanaReciente: string
  const eventos: string[] = []

  async function insertar(
    tabla: string,
    valores: Record<string, unknown>,
    vence: boolean
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from(tabla as 'asistencias')
      .insert(valores as never)
      .select('id')
      .single()
    expect(error, tabla).toBeNull()
    filas.push({ tabla, id: data!.id, vence })
    return data!.id
  }

  async function existe(f: Fila): Promise<boolean> {
    const { data, error } = await serviceClient
      .from(f.tabla as 'asistencias')
      .select('id')
      .eq('id', f.id)
      .maybeSingle()
    expect(error, f.tabla).toBeNull()
    return data !== null
  }

  async function copias(ids: string[]): Promise<number> {
    const { count, error } = await serviceClient
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('registro_id', ids)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function huerfana(agenda: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('biberones')
      .insert({ agenda_id: agenda, hora: '11:00', cantidad_ml: 90, tipo: 'agua' })
      .select('id')
      .single()
    expect(error).toBeNull()
    const { error: dErr } = await serviceClient.from('biberones').delete().eq('id', data!.id)
    expect(dErr).toBeNull()
    return data!.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Operativa')
    otroCentro = await createTestCentro('Centro Retencion Operativa Otro')
    admin = await createTestUser({ nombre: 'Admin Retencion Operativa' })
    await asignarRol(admin.id, centro.id, 'admin')
    cursoViejo = (await createTestCurso(centro.id, 'cerrado')).id
    const { error: cErr } = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_inicio: '1995-09-01', fecha_fin: '1996-07-31' })
      .eq('id', cursoViejo)
    expect(cErr).toBeNull()
    await createTestCurso(centro.id)
    // El otro centro no tiene ningún curso viejo: su registro de 1996 cuenta con el de 2026-27.
    await createTestCurso(otroCentro.id)

    const pl = await serviceClient
      .from('plantillas_informe')
      .insert({ centro_id: centro.id, titulo: 'Plantilla', creado_por: admin.id })
      .select('id')
      .single()
    expect(pl.error).toBeNull()
    plantilla = pl.data!.id

    const nino = (await createTestNino(centro.id, 'Nino Retencion Operativa')).id
    const nino2 = (await createTestNino(centro.id, 'Nino Retencion Operativa 2')).id
    const ninoOtro = (await createTestNino(otroCentro.id, 'Nino Retencion Operativa Otro')).id

    // ---- Vence: su fecha más tardía cae en el curso de 1995-96 ----
    const agenda = await insertar(
      'agendas_diarias',
      { nino_id: nino, fecha: '1996-03-01', observaciones_generales: 'obs' },
      true
    )
    await insertar('comidas', { agenda_id: agenda, momento: 'comida', cantidad: 'todo' }, true)
    await insertar('asistencias', { nino_id: nino, fecha: '1996-03-01', estado: 'presente' }, true)
    await insertar(
      'ausencias',
      {
        nino_id: nino,
        fecha_inicio: '1996-03-02',
        fecha_fin: '1996-03-03',
        motivo: 'enfermedad',
        created_at: VIEJO('1996-03-01'),
      },
      true
    )
    await insertar(
      'informes_evolucion',
      {
        centro_id: centro.id,
        nino_id: nino,
        curso_academico_id: cursoViejo,
        periodo: 'trimestre_1',
        plantilla_id: plantilla,
        estructura_snapshot: {},
        creado_por: admin.id,
        created_at: VIEJO('1996-01-15'),
        updated_at: VIEJO('1996-06-01'),
      },
      true
    )
    const conv = await insertar(
      'conversaciones',
      { nino_id: nino, centro_id: centro.id, created_at: VIEJO('1995-10-01') },
      true
    )
    await insertar(
      'mensajes',
      {
        conversacion_id: conv,
        autor_id: admin.id,
        contenido: 'viejo',
        created_at: VIEJO('1996-02-01'),
      },
      true
    )
    const cita = await insertar(
      'citas',
      {
        centro_id: centro.id,
        tipo: 'reunion_familia',
        organizador_id: admin.id,
        nino_id: nino,
        titulo: 'Cita',
        fecha: '1996-02-10',
        hora_inicio: '17:00',
        created_at: VIEJO('1996-02-01'),
      },
      true
    )
    await insertar(
      'cita_invitados',
      { cita_id: cita, centro_id: centro.id, usuario_id: admin.id },
      true
    )
    await insertar(
      'recordatorios',
      {
        centro_id: centro.id,
        destinatario: 'familia_individual',
        nino_id: nino,
        creado_por: admin.id,
        titulo: 'Recordatorio',
        created_at: VIEJO('1996-01-10'),
      },
      true
    )
    const ev = await serviceClient
      .from('eventos')
      .insert({
        centro_id: centro.id,
        ambito: 'centro',
        tipo: 'fiesta',
        titulo: 'Fiesta vieja',
        fecha: '1996-05-01',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    expect(ev.error).toBeNull()
    eventos.push(ev.data!.id)
    await insertar(
      'confirmaciones_evento',
      {
        evento_id: ev.data!.id,
        nino_id: nino,
        estado: 'confirmado',
        confirmado_por: admin.id,
        created_at: VIEJO('1996-04-01'),
      },
      true
    )

    // ---- Se queda ----
    // Verano entre dos cursos: cuenta con el siguiente, que no ha terminado.
    const agendaVerano = await insertar(
      'agendas_diarias',
      { nino_id: nino, fecha: '1996-08-15' },
      false
    )
    // Día viejo, alta de hoy.
    await insertar(
      'ausencias',
      { nino_id: nino, fecha_inicio: '1996-03-10', fecha_fin: '1996-03-11', motivo: 'enfermedad' },
      false
    )
    // Conversación vieja con un mensaje de hoy: el mensaje viejo vence, ella y el de hoy no.
    const convMixta = await insertar(
      'conversaciones',
      { nino_id: nino2, centro_id: centro.id, created_at: VIEJO('1995-10-01') },
      false
    )
    await insertar(
      'mensajes',
      {
        conversacion_id: convMixta,
        autor_id: admin.id,
        contenido: 'viejo',
        created_at: VIEJO('1996-02-01'),
      },
      true
    )
    await insertar(
      'mensajes',
      { conversacion_id: convMixta, autor_id: admin.id, contenido: 'de hoy' },
      false
    )
    // Otro centro, sin curso viejo.
    await insertar('agendas_diarias', { nino_id: ninoOtro, fecha: '1996-03-01' }, false)
    // El evento de ámbito niño no es operativa: se va con las firmas, no aquí.
    const evNino = await serviceClient
      .from('eventos')
      .insert({
        centro_id: centro.id,
        ambito: 'nino',
        nino_id: nino,
        tipo: 'otro',
        titulo: 'Evento del niño',
        fecha: '1996-05-02',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    expect(evNino.error).toBeNull()
    eventos.push(evNino.data!.id)

    // ---- Copias de filas ya borradas ----
    huerfanaVieja = await huerfana(agendaVerano)
    huerfanaReciente = await huerfana(agendaVerano)
    const { error: tErr } = await serviceClient
      .from('audit_log')
      .update({ ts: VIEJO('1996-03-01') })
      .eq('registro_id', huerfanaVieja)
    expect(tErr).toBeNull()
  }, 180_000)

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
    await deleteTestUser(admin.id)
  }, 120_000)

  it('solo service_role, y con un plazo válido', async () => {
    const sesion = await clientFor(admin)
    const { error } = await sesion.rpc('purgar_operativa_vencida', {
      p_anios: ANIOS,
      p_simular: true,
    })
    expect(error?.code).toBe('42501')

    const { error: cero } = await serviceClient.rpc('purgar_operativa_vencida', {
      p_anios: 0,
      p_simular: true,
    })
    expect(cero?.code).toBe('22023')
  })

  it('simula sin borrar, borra lo vencido con sus copias y deja lo demás', async () => {
    const vencen = filas.filter((f) => f.vence)
    const quedan = filas.filter((f) => !f.vence)

    // Premisa: todo vivo, con sus copias, y las dos huérfanas con las suyas.
    for (const f of filas) expect(await existe(f), `${f.tabla} antes`).toBe(true)
    expect(await copias(vencen.map((f) => f.id))).toBeGreaterThan(0)
    const copiasQuedan = await copias(quedan.map((f) => f.id))
    expect(copiasQuedan).toBeGreaterThan(0)
    expect(await copias([huerfanaVieja])).toBe(2)
    expect(await copias([huerfanaReciente])).toBe(2)

    // La simulación cuenta por tabla, justo las de TABLAS_OPERATIVA, y no borra nada.
    const sim = await serviceClient.rpc('purgar_operativa_vencida', {
      p_anios: ANIOS,
      p_simular: true,
    })
    expect(sim.error).toBeNull()
    const simulado = sim.data as Record<string, number>
    expect(Object.keys(simulado).sort()).toEqual([...TABLAS_OPERATIVA, 'copias_huerfanas'].sort())
    for (const t of TABLAS_OPERATIVA) {
      const mias = vencen.filter((f) => f.tabla === t).length
      expect(simulado[t], t).toBeGreaterThanOrEqual(mias)
    }
    expect(simulado.copias_huerfanas).toBeGreaterThanOrEqual(2)
    for (const f of filas) expect(await existe(f), `${f.tabla} tras simular`).toBe(true)

    // El borrado: lo mismo que la simulación.
    const real = await serviceClient.rpc('purgar_operativa_vencida', {
      p_anios: ANIOS,
      p_simular: false,
    })
    expect(real.error).toBeNull()
    expect(real.data).toEqual(simulado)

    for (const f of vencen) expect(await existe(f), `${f.tabla} vence`).toBe(false)
    expect(await copias(vencen.map((f) => f.id))).toBe(0)
    expect(await copias([huerfanaVieja])).toBe(0)

    for (const f of quedan) expect(await existe(f), `${f.tabla} se queda`).toBe(true)
    expect(await copias(quedan.map((f) => f.id))).toBe(copiasQuedan)
    expect(await copias([huerfanaReciente])).toBe(2)

    const { data: evs } = await serviceClient.from('eventos').select('id').in('id', eventos)
    expect((evs ?? []).length).toBe(eventos.length)

    // Una segunda pasada ya no encuentra nada de este fichero.
    const otra = await serviceClient.rpc('purgar_operativa_vencida', {
      p_anios: ANIOS,
      p_simular: true,
    })
    expect(otra.error).toBeNull()
    for (const t of TABLAS_OPERATIVA) expect((otra.data as Record<string, number>)[t], t).toBe(0)
  })
})
