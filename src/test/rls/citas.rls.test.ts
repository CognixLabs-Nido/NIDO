import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de `citas`, `cita_invitados` y `preferencias_usuario` (F7b — Agenda).
 * **Gated** por `AGENDA_MIGRATION_APPLIED=1`: la migración
 * `20260602120000_phase7b_agenda.sql` se aplica manualmente vía SQL Editor (CLI
 * con bug SIGILL).
 *
 * Comando: `AGENDA_MIGRATION_APPLIED=1 npm run test:rls -- citas.rls`
 *
 * Cubre: INSERT por rol×tipo (admin 4 tipos; profe solo familia/clase; tutor
 * denegado), el gotcha MVCC `.insert().select()` en `citas` (4 tipos) y en
 * `cita_invitados`, aislamiento SELECT + roster privado (un invitado solo ve su
 * fila), RSVP solo sobre la fila propia, alta/baja de invitados solo
 * organizador/admin, y aislamiento de `preferencias_usuario`.
 */
const MIGRATION_APPLIED = process.env.AGENDA_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS citas — F7b (agenda)', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let tutorOtro: TestUser
  let nino: { id: string }
  const citasCreadas: string[] = []

  type CitaInsert = Database['public']['Tables']['citas']['Insert']

  async function crearCitaComo(
    user: TestUser,
    row: Partial<CitaInsert> & { tipo: CitaInsert['tipo'] }
  ): Promise<{ id?: string; error: unknown }> {
    const c = await clientFor(user)
    const payload = {
      titulo: 'Cita Test',
      fecha: '2026-09-10',
      hora_inicio: '17:00',
      organizador_id: user.id,
      centro_id: centro.id,
      ...row,
    } as CitaInsert
    const { data, error } = await c.from('citas').insert(payload).select('id').maybeSingle()
    if (data?.id) citasCreadas.push(data.id)
    return { id: data?.id, error }
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Agenda')
    centroB = await createTestCentro('Centro Agenda B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Agenda')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Agenda B')
    nino = await createTestNino(centro.id, 'Agenda Nino')
    await matricular(nino.id, aula.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin Ag' })
    profe = await createTestUser({ nombre: 'Profe Ag' })
    tutor = await createTestUser({ nombre: 'Tutor Ag' })
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro Ag' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(tutorOtro.id, centroB.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
  })

  afterAll(async () => {
    for (const id of citasCreadas) await serviceClient.from('citas').delete().eq('id', id)
    await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', tutor.id)
    await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', tutorOtro.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, profe, tutor, tutorOtro]) await deleteTestUser(u.id)
  })

  // --- INSERT por rol × tipo + MVCC en citas --------------------------------

  it('admin crea los 4 tipos con .insert().select() (MVCC row-aware)', async () => {
    const fam = await crearCitaComo(admin, { tipo: 'reunion_familia', nino_id: nino.id })
    expect(fam.error).toBeNull()
    expect(fam.id).toBeTruthy()
    const cla = await crearCitaComo(admin, { tipo: 'reunion_clase', aula_id: aula.id })
    expect(cla.id).toBeTruthy()
    const clau = await crearCitaComo(admin, { tipo: 'reunion_claustro' })
    expect(clau.id).toBeTruthy()
    const vis = await crearCitaComo(admin, { tipo: 'visita' })
    expect(vis.id).toBeTruthy()
  })

  it('profe crea reunion_familia (su niño) y reunion_clase (su aula)', async () => {
    const fam = await crearCitaComo(profe, { tipo: 'reunion_familia', nino_id: nino.id })
    expect(fam.id).toBeTruthy()
    const cla = await crearCitaComo(profe, { tipo: 'reunion_clase', aula_id: aula.id })
    expect(cla.id).toBeTruthy()
  })

  it('profe NO crea claustro, visita, ni clase de otra aula', async () => {
    const clau = await crearCitaComo(profe, { tipo: 'reunion_claustro' })
    expect(clau.id).toBeFalsy()
    const vis = await crearCitaComo(profe, { tipo: 'visita' })
    expect(vis.id).toBeFalsy()
    const otraAula = await crearCitaComo(profe, { tipo: 'reunion_clase', aula_id: aulaB.id })
    expect(otraAula.id).toBeFalsy()
  })

  it('tutor no puede crear ninguna cita', async () => {
    const fam = await crearCitaComo(tutor, { tipo: 'reunion_familia', nino_id: nino.id })
    expect(fam.id).toBeFalsy()
  })

  // --- cita_invitados: MVCC, roster privado, RSVP, alta/baja ----------------

  it('organizador inserta invitados con .insert().select() (MVCC) y roster privado', async () => {
    const { data: cita } = await serviceClient
      .from('citas')
      .insert({
        tipo: 'reunion_clase',
        centro_id: centro.id,
        aula_id: aula.id,
        organizador_id: admin.id,
        titulo: 'Con invitados',
        fecha: '2026-10-01',
        hora_inicio: '17:00',
      })
      .select('id')
      .single()
    citasCreadas.push(cita!.id)

    const cAdmin = await clientFor(admin)
    const insTutor = await cAdmin
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: tutor.id })
      .select('id')
      .maybeSingle()
    expect(insTutor.error).toBeNull()
    expect(insTutor.data?.id).toBeTruthy()

    await cAdmin
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: profe.id })

    // Roster privado: el invitado (tutor) solo ve SU fila.
    const cTutor = await clientFor(tutor)
    const { data: vistosTutor } = await cTutor
      .from('cita_invitados')
      .select('id, usuario_id')
      .eq('cita_id', cita!.id)
    expect(vistosTutor?.length).toBe(1)
    expect(vistosTutor?.[0]?.usuario_id).toBe(tutor.id)

    // El organizador (admin) ve la lista completa (2).
    const { data: vistosAdmin } = await cAdmin
      .from('cita_invitados')
      .select('id')
      .eq('cita_id', cita!.id)
    expect(vistosAdmin?.length).toBe(2)

    // tutorOtro (otro centro, no invitado) no ve la cita.
    const cOtro = await clientFor(tutorOtro)
    const { data: noVe } = await cOtro.from('citas').select('id').eq('id', cita!.id)
    expect(noVe?.length ?? 0).toBe(0)
  })

  it('un invitado responde su fila pero no la de otro; no puede añadir ni borrar', async () => {
    const { data: cita } = await serviceClient
      .from('citas')
      .insert({
        tipo: 'reunion_clase',
        centro_id: centro.id,
        aula_id: aula.id,
        organizador_id: admin.id,
        titulo: 'RSVP',
        fecha: '2099-01-01',
        hora_inicio: '17:00',
      })
      .select('id')
      .single()
    citasCreadas.push(cita!.id)

    const { data: filaTutor } = await serviceClient
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: tutor.id })
      .select('id')
      .single()
    const { data: filaProfe } = await serviceClient
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: profe.id })
      .select('id')
      .single()

    const cTutor = await clientFor(tutor)

    // Responde su propia fila.
    const propia = await cTutor
      .from('cita_invitados')
      .update({ estado: 'aceptado', respondido_por: tutor.id })
      .eq('id', filaTutor!.id)
      .select('id')
      .maybeSingle()
    expect(propia.data?.id).toBeTruthy()

    // No puede tocar la fila de profe (0 filas, sin error).
    const ajena = await cTutor
      .from('cita_invitados')
      .update({ estado: 'aceptado', respondido_por: tutor.id })
      .eq('id', filaProfe!.id)
      .select('id')
      .maybeSingle()
    expect(ajena.data?.id).toBeFalsy()

    // No puede añadir invitados (RLS INSERT solo organizador/admin).
    const alta = await cTutor
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: tutorOtro.id })
      .select('id')
      .maybeSingle()
    expect(alta.data?.id).toBeFalsy()

    // No puede borrar su fila (DELETE solo organizador/admin).
    await cTutor.from('cita_invitados').delete().eq('id', filaTutor!.id)
    const { data: sigue } = await serviceClient
      .from('cita_invitados')
      .select('id')
      .eq('id', filaTutor!.id)
    expect(sigue?.length).toBe(1)
  })

  it('el organizador sí puede quitar un invitado', async () => {
    const { data: cita } = await serviceClient
      .from('citas')
      .insert({
        tipo: 'reunion_claustro',
        centro_id: centro.id,
        organizador_id: admin.id,
        titulo: 'Quitar',
        fecha: '2099-02-01',
        hora_inicio: '17:00',
      })
      .select('id')
      .single()
    citasCreadas.push(cita!.id)
    const { data: fila } = await serviceClient
      .from('cita_invitados')
      .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: profe.id })
      .select('id')
      .single()

    const cAdmin = await clientFor(admin)
    const del = await cAdmin
      .from('cita_invitados')
      .delete()
      .eq('id', fila!.id)
      .select('id')
      .maybeSingle()
    expect(del.data?.id).toBeTruthy()
    const { data: sigue } = await serviceClient
      .from('cita_invitados')
      .select('id')
      .eq('id', fila!.id)
    expect(sigue?.length ?? 0).toBe(0)
  })

  // --- preferencias_usuario --------------------------------------------------

  it('preferencias_usuario: cada usuario solo ve/escribe las suyas', async () => {
    const cTutor = await clientFor(tutor)
    const up = await cTutor
      .from('preferencias_usuario')
      .upsert(
        { usuario_id: tutor.id, clave: 'agenda_vista', valor: 'semana' },
        { onConflict: 'usuario_id,clave' }
      )
      .select('clave')
      .maybeSingle()
    expect(up.data?.clave).toBe('agenda_vista')

    // tutorOtro no ve la preferencia de tutor.
    const cOtro = await clientFor(tutorOtro)
    const { data: ajenas } = await cOtro
      .from('preferencias_usuario')
      .select('usuario_id')
      .eq('usuario_id', tutor.id)
    expect(ajenas?.length ?? 0).toBe(0)

    // No puede falsear usuario_id (WITH CHECK usuario_id = auth.uid()).
    const falsa = await cOtro
      .from('preferencias_usuario')
      .insert({ usuario_id: tutor.id, clave: 'hack', valor: 'x' })
      .select('clave')
      .maybeSingle()
    expect(falsa.data?.clave).toBeFalsy()
  })
})

/**
 * RPC `contar_invitaciones_pendientes()` (AG-14, badge). `SECURITY DEFINER STABLE`
 * que cuenta sobre `auth.uid()`: invitaciones RSVP **pendientes** del usuario en
 * citas **programadas y aún no comenzadas** (ventana AG-11), excluyendo las que el
 * propio usuario organiza. Usa usuarios **dedicados y aislados** para que los
 * recuentos sean deterministas (otros tests de este fichero invitan a tutor/profe
 * a citas futuras, que el RPC también contaría).
 *
 * Comando: `AGENDA_MIGRATION_APPLIED=1 npm run test:rls -- citas.rls`
 */
describe.skipIf(!MIGRATION_APPLIED)(
  'RPC contar_invitaciones_pendientes — F7b badge (AG-14)',
  () => {
    let centro: { id: string }
    let aula: { id: string }
    let organizador: TestUser
    let invitado: TestUser
    let otro: TestUser
    const citasCreadas: string[] = []

    type CitaInsert = Database['public']['Tables']['citas']['Insert']

    /** Crea una cita vía service role (controla organizador/fecha/estado) y registra su id. */
    async function nuevaCita(
      row: Partial<CitaInsert> & { organizador_id: string }
    ): Promise<string> {
      const { data } = await serviceClient
        .from('citas')
        .insert({
          tipo: 'reunion_clase',
          centro_id: centro.id,
          aula_id: aula.id,
          titulo: 'Badge',
          fecha: '2099-06-01',
          hora_inicio: '17:00',
          ...row,
        } as CitaInsert)
        .select('id')
        .single()
      citasCreadas.push(data!.id)
      return data!.id
    }

    async function invitar(citaId: string, usuarioId: string): Promise<string> {
      const { data } = await serviceClient
        .from('cita_invitados')
        .insert({ cita_id: citaId, centro_id: centro.id, usuario_id: usuarioId })
        .select('id')
        .single()
      return data!.id
    }

    async function recuento(user: TestUser): Promise<number> {
      const c = await clientFor(user)
      const { data, error } = await c.rpc('contar_invitaciones_pendientes')
      expect(error).toBeNull()
      return data ?? -1
    }

    beforeAll(async () => {
      centro = await createTestCentro('Centro Badge')
      const curso = await createTestCurso(centro.id)
      aula = await createTestAula(centro.id, curso.id, 'Aula Badge')
      organizador = await createTestUser({ nombre: 'Org Badge' })
      invitado = await createTestUser({ nombre: 'Inv Badge' })
      otro = await createTestUser({ nombre: 'Otro Badge' })
      await asignarRol(organizador.id, centro.id, 'admin')
      await asignarRol(invitado.id, centro.id, 'profe')
      await asignarRol(otro.id, centro.id, 'profe')
    })

    afterAll(async () => {
      for (const id of citasCreadas) await serviceClient.from('citas').delete().eq('id', id)
      await deleteTestCentro(centro.id)
      for (const u of [organizador, invitado, otro]) await deleteTestUser(u.id)
    })

    it('cuenta solo pendientes futuras del invitado; el organizador no cuenta las suyas', async () => {
      // cuenta: futura, programada, invitado convocado.
      const cFutura = await nuevaCita({ organizador_id: organizador.id, fecha: '2099-06-01' })
      await invitar(cFutura, invitado.id)
      // NO cuenta: ya comenzó (ventana AG-11).
      const cPasada = await nuevaCita({ organizador_id: organizador.id, fecha: '2020-01-01' })
      await invitar(cPasada, invitado.id)
      // NO cuenta: cancelada.
      const cCancel = await nuevaCita({
        organizador_id: organizador.id,
        fecha: '2099-06-02',
        estado: 'cancelada',
      })
      await invitar(cCancel, invitado.id)

      // El organizador es invitado a SU propia cita → no cuenta (organizador_id = auth.uid()).
      const cPropia = await nuevaCita({ organizador_id: organizador.id, fecha: '2099-06-03' })
      await invitar(cPropia, organizador.id)
      // Pero sí cuenta una cita futura que organiza OTRO y a la que se le convoca.
      const cAjena = await nuevaCita({ organizador_id: otro.id, fecha: '2099-06-04' })
      await invitar(cAjena, organizador.id)

      // invitado: solo cFutura.
      expect(await recuento(invitado)).toBe(1)
      // organizador: solo cAjena (cPropia excluida por el guard del organizador).
      expect(await recuento(organizador)).toBe(1)
      // otro: organiza cAjena pero no está invitado a nada → 0 (scoping por auth.uid()).
      expect(await recuento(otro)).toBe(0)
    })

    it('al aceptar la invitación deja de contar como pendiente', async () => {
      const cita = await nuevaCita({ organizador_id: organizador.id, fecha: '2099-07-01' })
      const fila = await invitar(cita, otro.id)

      expect(await recuento(otro)).toBe(1)
      await serviceClient.from('cita_invitados').update({ estado: 'aceptado' }).eq('id', fila)
      expect(await recuento(otro)).toBe(0)
    })
  }
)
