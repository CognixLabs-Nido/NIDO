import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
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
 * El olvido alcanza la operativa del niño (F11-B, punto 6, PR-4; 20261201120000).
 *
 * `purgar_sujeto_db` anonimizaba la ficha y dejaba entera la agenda, la asistencia, los mensajes,
 * los informes… Ahora los borra con sus copias en audit_log: las de lo que borra y las de lo que
 * se había borrado antes (un biberón, una agenda entera con su comida, un invitado de una cita),
 * que ya no tienen tabla en la que vivir. El otro niño del centro conserva todo, y lo que no es
 * operativa (el evento del centro, el evento de ámbito niño) se queda.
 */

const OPERATIVA = [
  'agendas_diarias',
  'asistencias',
  'ausencias',
  'informes_evolucion',
  'conversaciones',
  'citas',
  'recordatorios',
  'confirmaciones_evento',
] as const

interface Sembrado {
  ninoId: string
  /** Los ids de todo lo sembrado, también lo que se borró antes de la purga. */
  ids: string[]
  agenda: string
  conversacion: string
  cita: string
}

describe('Olvido del niño — su operativa', () => {
  let centro: { id: string }
  let curso: { id: string }
  let admin: TestUser
  let plantilla: string
  let eventoCentro: string
  const solicitudes: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Olvido Operativa')
    curso = await createTestCurso(centro.id)
    admin = await createTestUser({ nombre: 'Admin Olvido Operativa' })
    await asignarRol(admin.id, centro.id, 'admin')
    const pl = await serviceClient
      .from('plantillas_informe')
      .insert({ centro_id: centro.id, titulo: 'Plantilla', creado_por: admin.id })
      .select('id')
      .single()
    expect(pl.error).toBeNull()
    plantilla = pl.data!.id
    const ev = await serviceClient
      .from('eventos')
      .insert({
        centro_id: centro.id,
        ambito: 'centro',
        tipo: 'fiesta',
        titulo: 'Fiesta',
        fecha: '2026-12-20',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    expect(ev.error).toBeNull()
    eventoCentro = ev.data!.id
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 120_000)

  async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
    const { data, error } = await serviceClient
      .from(tabla as 'asistencias')
      .insert(fila as never)
      .select('id')
      .single()
    expect(error, tabla).toBeNull()
    return data!.id
  }

  async function borrar(tabla: string, id: string) {
    const { error } = await serviceClient
      .from(tabla as 'asistencias')
      .delete()
      .eq('id', id)
    expect(error, tabla).toBeNull()
  }

  async function sembrar(nombre: string): Promise<Sembrado> {
    const nino = await createTestNino(centro.id, nombre)
    const n = nino.id
    const ids: string[] = []
    const fila = async (tabla: string, valores: Record<string, unknown>) => {
      const id = await insertar(tabla, valores)
      ids.push(id)
      return id
    }

    const agenda = await fila('agendas_diarias', {
      nino_id: n,
      fecha: '2026-10-01',
      observaciones_generales: 'obs',
    })
    await fila('biberones', { agenda_id: agenda, hora: '10:00', cantidad_ml: 120, tipo: 'formula' })
    await fila('comidas', { agenda_id: agenda, momento: 'comida', cantidad: 'todo' })
    await fila('suenos', { agenda_id: agenda, hora_inicio: '13:00' })
    await fila('deposiciones', { agenda_id: agenda, tipo: 'pipi', cantidad: 'normal' })
    await fila('asistencias', { nino_id: n, fecha: '2026-10-01', estado: 'presente' })
    await fila('ausencias', {
      nino_id: n,
      fecha_inicio: '2026-10-02',
      fecha_fin: '2026-10-03',
      motivo: 'enfermedad',
    })
    await fila('informes_evolucion', {
      centro_id: centro.id,
      nino_id: n,
      curso_academico_id: curso.id,
      periodo: 'trimestre_1',
      plantilla_id: plantilla,
      estructura_snapshot: {},
      creado_por: admin.id,
    })
    const conversacion = await fila('conversaciones', { nino_id: n, centro_id: centro.id })
    await fila('mensajes', { conversacion_id: conversacion, autor_id: admin.id, contenido: 'hola' })
    const cita = await fila('citas', {
      centro_id: centro.id,
      tipo: 'reunion_familia',
      organizador_id: admin.id,
      nino_id: n,
      titulo: 'Cita',
      fecha: '2026-11-10',
      hora_inicio: '17:00',
    })
    await fila('cita_invitados', { cita_id: cita, centro_id: centro.id, usuario_id: admin.id })
    await fila('recordatorios', {
      centro_id: centro.id,
      destinatario: 'familia_individual',
      nino_id: n,
      creado_por: admin.id,
      titulo: 'Recordatorio',
    })
    await fila('confirmaciones_evento', {
      evento_id: eventoCentro,
      nino_id: n,
      estado: 'confirmado',
      confirmado_por: admin.id,
    })

    // Borrado antes de la purga, sin ella: su DELETE se audita entero y la copia se queda.
    const biberonViejo = await fila('biberones', {
      agenda_id: agenda,
      hora: '11:00',
      cantidad_ml: 90,
      tipo: 'agua',
    })
    await borrar('biberones', biberonViejo)
    const agendaVieja = await fila('agendas_diarias', { nino_id: n, fecha: '2026-09-15' })
    await fila('comidas', {
      agenda_id: agendaVieja,
      momento: 'merienda',
      cantidad: 'poco',
      observaciones: 'obs',
    })
    await borrar('agendas_diarias', agendaVieja)
    const invitadoViejo = await fila('cita_invitados', {
      cita_id: cita,
      centro_id: centro.id,
      nombre_externo: 'Externo',
    })
    await borrar('cita_invitados', invitadoViejo)

    return { ninoId: n, ids, agenda, conversacion, cita }
  }

  async function filasVivas(s: Sembrado): Promise<Record<string, number>> {
    const vivas: Record<string, number> = {}
    for (const tabla of OPERATIVA) {
      const { data, error } = await serviceClient.from(tabla).select('id').eq('nino_id', s.ninoId)
      expect(error, tabla).toBeNull()
      vivas[tabla] = (data ?? []).length
    }
    for (const tabla of ['comidas', 'biberones', 'suenos', 'deposiciones'] as const) {
      const { data } = await serviceClient.from(tabla).select('id').eq('agenda_id', s.agenda)
      vivas[tabla] = (data ?? []).length
    }
    const { data: m } = await serviceClient
      .from('mensajes')
      .select('id')
      .eq('conversacion_id', s.conversacion)
    vivas.mensajes = (m ?? []).length
    const { data: ci } = await serviceClient
      .from('cita_invitados')
      .select('id')
      .eq('cita_id', s.cita)
    vivas.cita_invitados = (ci ?? []).length
    return vivas
  }

  /** Las copias en audit_log de todo lo sembrado, por tabla y acción. */
  async function copias(s: Sembrado): Promise<string[]> {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion')
      .in('registro_id', s.ids)
    expect(error).toBeNull()
    return (data ?? []).map((f) => `${f.tabla} ${f.accion}`).sort()
  }

  it('borra la operativa del niño con todas sus copias; el otro niño y lo que no es operativa se quedan', async () => {
    const olvidado = await sembrar('Nino Olvido Operativa')
    const otro = await sembrar('Nino Otro Operativa')
    const eventoNino = await insertar('eventos', {
      centro_id: centro.id,
      ambito: 'nino',
      nino_id: olvidado.ninoId,
      tipo: 'otro',
      titulo: 'Evento del niño',
      fecha: '2026-12-01',
      creado_por: admin.id,
    })

    // Premisa: todo vivo y con sus copias, también las de lo borrado antes.
    const vivasAntes = await filasVivas(olvidado)
    for (const [tabla, n] of Object.entries(vivasAntes)) expect(n, tabla).toBeGreaterThan(0)
    const copiasAntes = await copias(olvidado)
    for (const huerfana of [
      'biberones DELETE',
      'agendas_diarias DELETE',
      'comidas DELETE',
      'cita_invitados DELETE',
    ]) {
      expect(copiasAntes).toContain(huerfana)
    }
    const otroAntes = { vivas: await filasVivas(otro), copias: await copias(otro) }

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: olvidado.ninoId,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const vivas = await filasVivas(olvidado)
    expect(
      Object.values(vivas).every((n) => n === 0),
      JSON.stringify(vivas)
    ).toBe(true)
    expect(await copias(olvidado)).toEqual([])

    expect(await filasVivas(otro)).toEqual(otroAntes.vivas)
    expect(await copias(otro)).toEqual(otroAntes.copias)

    const { data: eventos } = await serviceClient
      .from('eventos')
      .select('id')
      .in('id', [eventoCentro, eventoNino])
    expect((eventos ?? []).map((e) => e.id).sort()).toEqual([eventoCentro, eventoNino].sort())
  })
})
