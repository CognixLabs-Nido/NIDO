import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestNino,
  type TestUser,
} from '../rls/setup'

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import { recolectarAdjuntosDe } from '@/features/olvido/lib/fuentes-adjuntos'
import { BUCKET_DNI_TUTORES, BUCKET_USUARIOS_FOTOS } from '@/shared/lib/adjuntos/storage'

/**
 * Multicentro · Fase 2 · PR B — el olvido es por centro (`20261022120000`).
 *
 * Una tutora con hijos en dos centros. Pedir el olvido en A retira sus roles de A y no bloquea la
 * cuenta; purgar A borra lo de A y deja intacto lo de B y la cuenta. Pedirlo después en B bloquea
 * la cuenta, y purgar B (el último centro) hace la purga entera de siempre. Cada caso empieza por
 * su premisa: lo que se va a borrar está en los dos centros.
 */

const BORRADO = '[borrado]'

type Sesion = SupabaseClient<Database>

describe('Olvido por centro — solicitud y purga partidas', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let centroC: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let otro: TestUser
  const usuarios: TestUser[] = []
  const ninos: TestNino[] = []

  /** Una tutora con un hijo en cada centro, todo lo que la purga toca, y su nombre en un
   *  mensaje de otra persona en cada centro. */
  async function tutoraEnDosCentros(nombre: string) {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    await serviceClient.from('usuarios').update({ nombre_completo: nombre }).eq('id', u.id)
    const porCentro: Record<
      'A' | 'B',
      { nino: TestNino; ft: string; conv: string; msg: string; dni: string }
    > = {} as never
    for (const [clave, centro] of [
      ['A', centroA],
      ['B', centroB],
    ] as const) {
      await asignarRol(u.id, centro.id, 'tutor_legal')
      const nino = await createTestNino(centro.id, `Hijo ${clave} ${nombre}`)
      ninos.push(nino)
      await crearVinculo(nino.id, u.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
      const ft = await crearFamiliaTutor(nino.familia_id, u.id)
      const dni = `${centro.id}/${nino.id}/dni-${clave}.pdf`
      const upd = await serviceClient
        .from('familia_tutores')
        .update({ nombre_completo: nombre, email: u.email, dni_documento_path: dni })
        .eq('id', ft)
      if (upd.error) throw new Error(`familia_tutores ${clave}: ${upd.error.message}`)
      const c = await serviceClient
        .from('conversaciones')
        .insert({ nino_id: nino.id, centro_id: centro.id })
        .select('id')
        .single()
      if (c.error || !c.data) throw new Error(`conversación ${clave}: ${c.error?.message}`)
      const m = await serviceClient
        .from('mensajes')
        .insert({ conversacion_id: c.data.id, autor_id: otro.id, contenido: `Recoge ${nombre}` })
        .select('id')
        .single()
      if (m.error || !m.data) throw new Error(`mensaje ${clave}: ${m.error?.message}`)
      await serviceClient.from('lectura_conversacion').insert({
        usuario_id: u.id,
        conversacion_id: c.data.id,
        last_read_at: new Date().toISOString(),
      })
      await serviceClient.from('consentimientos').insert({
        usuario_id: u.id,
        nino_id: nino.id,
        tipo: 'imagen',
        version: 'v1',
        ip_address: '10.0.0.1',
        user_agent: 'Mozilla/Test',
      })
      porCentro[clave] = { nino, ft, conv: c.data.id, msg: m.data.id, dni }
    }
    return { u, ...porCentro }
  }

  async function solicitar(usuarioId: string, centroId: string): Promise<string> {
    const { data, error } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: usuarioId,
      p_centro_id: centroId,
      p_inmediato: true,
    })
    if (error || !data) throw new Error(`solicitar: ${error?.message}`)
    return data
  }

  async function esUltimo(solicitudId: string): Promise<boolean | null> {
    const { data, error } = await serviceClient.rpc('olvido_es_ultimo_centro', {
      p_solicitud_id: solicitudId,
    })
    if (error) throw new Error(`olvido_es_ultimo_centro: ${error.message}`)
    return data
  }

  async function purgar(solicitudId: string) {
    const { error } = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: solicitudId })
    if (error) throw new Error(`purgar_sujeto_db: ${error.message}`)
  }

  async function roles(usuarioId: string) {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('centro_id, deleted_at, deleted_reason')
      .eq('usuario_id', usuarioId)
    return new Map((data ?? []).map((r) => [r.centro_id, r]))
  }

  async function contenido(mensajeId: string) {
    const { data } = await serviceClient
      .from('mensajes')
      .select('contenido')
      .eq('id', mensajeId)
      .single()
    return data?.contenido ?? ''
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Olvido Por Centro A')
    centroB = await createTestCentro('Centro Olvido Por Centro B')
    centroC = await createTestCentro('Centro Olvido Por Centro C')
    adminA = await createTestUser({ nombre: 'Admin Olvido A' })
    adminB = await createTestUser({ nombre: 'Admin Olvido B' })
    otro = await createTestUser({ nombre: 'Otra Persona Olvido' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
  }, 120_000)

  afterAll(async () => {
    const ids = [...usuarios.map((u) => u.id), adminA?.id, adminB?.id, otro?.id].filter(
      (u): u is string => Boolean(u)
    )
    await serviceClient.from('olvido_solicitudes').delete().in('sujeto_id', ids)
    await serviceClient.from('lectura_conversacion').delete().in('usuario_id', ids)
    await serviceClient.from('consentimientos').delete().in('usuario_id', ids)
    await serviceClient.from('mensajes').delete().in('autor_id', ids)
    await serviceClient.from('invitaciones').delete().in('centro_id', [centroA.id, centroB.id])
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', ids)
    for (const c of [centroA, centroB, centroC]) if (c) await deleteTestCentro(c.id)
    for (const u of ids) await deleteTestUser(u)
  }, 120_000)

  it('la solicitud sin centro ya no existe', async () => {
    const { error } = await serviceClient.rpc(
      'solicitar_olvido_usuario' as never,
      {
        p_usuario_id: otro.id,
        p_inmediato: true,
      } as never
    )
    expect(error?.code).toBe('PGRST202')
  })

  it('solo la dirección de ESE centro, y solo en un centro donde el usuario está', async () => {
    const t = await tutoraEnDosCentros('Tutora Permisos Olvido')
    const cAdminB: Sesion = await clientFor(adminB)
    const ajeno = await cAdminB.rpc('solicitar_olvido_usuario', {
      p_usuario_id: t.u.id,
      p_centro_id: centroA.id,
      p_inmediato: false,
    })
    expect(ajeno.error?.code).toBe('42501')
    const sinEl = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: t.u.id,
      p_centro_id: centroC.id,
      p_inmediato: false,
    })
    expect(sinEl.error?.code).toBe('P0002')
    // Premisa del rechazo: la dirección de B sí puede en B.
    const propio = await cAdminB.rpc('solicitar_olvido_usuario', {
      p_usuario_id: t.u.id,
      p_centro_id: centroB.id,
      p_inmediato: false,
    })
    expect(propio.error).toBeNull()
  })

  it('A, después B: cada purga borra lo de su centro, y la cuenta se va con el último', async () => {
    const t = await tutoraEnDosCentros('Tutora Dos Centros Olvido')
    // Premisa: su nombre está en los mensajes de los dos centros y tiene rol vivo en los dos.
    expect(await contenido(t.A.msg)).toContain('Tutora Dos Centros Olvido')
    expect(await contenido(t.B.msg)).toContain('Tutora Dos Centros Olvido')
    const antes = await roles(t.u.id)
    expect(antes.get(centroA.id)?.deleted_at).toBeNull()
    expect(antes.get(centroB.id)?.deleted_at).toBeNull()

    // Solicitud en A: se retira su rol de A, el de B sigue, la cuenta no se bloquea.
    const solA = await solicitar(t.u.id, centroA.id)
    const tras = await roles(t.u.id)
    expect(tras.get(centroA.id)).toMatchObject({ deleted_reason: 'solicitud_olvido' })
    expect(tras.get(centroB.id)?.deleted_at).toBeNull()
    const cuenta = await serviceClient
      .from('usuarios')
      .select('deleted_at')
      .eq('id', t.u.id)
      .single()
    expect(cuenta.data?.deleted_at).toBeNull()
    expect(await esUltimo(solA)).toBe(false)

    // El manifiesto de adjuntos: solo el DNI de A y nada de la cuenta; con el último, todo.
    const deA = await recolectarAdjuntosDe(
      serviceClient,
      { sujeto_tipo: 'usuario', sujeto_id: t.u.id, centro_id: centroA.id },
      false
    )
    expect(deA.get(BUCKET_DNI_TUTORES)).toEqual([t.A.dni])
    expect(deA.has(BUCKET_USUARIOS_FOTOS)).toBe(false)
    const todo = await recolectarAdjuntosDe(
      serviceClient,
      { sujeto_tipo: 'usuario', sujeto_id: t.u.id, centro_id: centroA.id },
      true
    )
    expect([...(todo.get(BUCKET_DNI_TUTORES) ?? [])].sort()).toEqual([t.A.dni, t.B.dni].sort())

    await purgar(solA)

    // A: borrado.
    expect(await contenido(t.A.msg)).toBe(`Recoge ${BORRADO}`)
    const ftA = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo, email, dni_documento_path, deleted_at')
      .eq('id', t.A.ft)
      .single()
    expect(ftA.data).toMatchObject({ nombre_completo: null, email: null, dni_documento_path: null })
    expect(ftA.data?.deleted_at).not.toBeNull()
    const vinA = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_reason')
      .eq('usuario_id', t.u.id)
      .eq('nino_id', t.A.nino.id)
      .single()
    expect(vinA.data?.deleted_reason).toBe('purga_rgpd')
    expect((await roles(t.u.id)).get(centroA.id)?.deleted_reason).toBe('purga_rgpd')

    // B y la cuenta: intactos.
    expect(await contenido(t.B.msg)).toContain('Tutora Dos Centros Olvido')
    const ftB = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo, dni_documento_path, deleted_at')
      .eq('id', t.B.ft)
      .single()
    expect(ftB.data).toMatchObject({
      nombre_completo: 'Tutora Dos Centros Olvido',
      deleted_at: null,
    })
    expect(ftB.data?.dni_documento_path).toBe(t.B.dni)
    const vinB = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('usuario_id', t.u.id)
      .eq('nino_id', t.B.nino.id)
      .single()
    expect(vinB.data?.deleted_at).toBeNull()
    expect((await roles(t.u.id)).get(centroB.id)?.deleted_at).toBeNull()
    const lecturas = await serviceClient
      .from('lectura_conversacion')
      .select('conversacion_id')
      .eq('usuario_id', t.u.id)
    expect((lecturas.data ?? []).map((l) => l.conversacion_id)).toEqual([t.B.conv])
    const consent = await serviceClient
      .from('consentimientos')
      .select('nino_id, ip_address')
      .eq('usuario_id', t.u.id)
    const ipPorNino = new Map((consent.data ?? []).map((c) => [c.nino_id, c.ip_address]))
    expect(ipPorNino.get(t.A.nino.id)).toBeNull()
    expect(ipPorNino.get(t.B.nino.id)).not.toBeNull()
    const nombre = await serviceClient
      .from('usuarios')
      .select('nombre_completo, deleted_at')
      .eq('id', t.u.id)
      .single()
    expect(nombre.data).toMatchObject({
      nombre_completo: 'Tutora Dos Centros Olvido',
      deleted_at: null,
    })

    // Solicitud en B, el último: la cuenta se bloquea y la purga se lleva todo.
    const solB = await solicitar(t.u.id, centroB.id)
    const bloqueada = await serviceClient
      .from('usuarios')
      .select('deleted_at')
      .eq('id', t.u.id)
      .single()
    expect(bloqueada.data?.deleted_at).not.toBeNull()
    expect(await esUltimo(solB)).toBe(true)
    await purgar(solB)
    expect(await contenido(t.B.msg)).toBe(`Recoge ${BORRADO}`)
    const fin = await serviceClient
      .from('usuarios')
      .select('nombre_completo')
      .eq('id', t.u.id)
      .single()
    expect(fin.data?.nombre_completo).toBe(BORRADO)
    const ftFin = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo')
      .eq('id', t.B.ft)
      .single()
    expect(ftFin.data?.nombre_completo).toBeNull()
  })

  it('con dos solicitudes pendientes, ninguna es la última hasta que se purga la otra', async () => {
    const t = await tutoraEnDosCentros('Tutora Dos Pendientes Olvido')
    const solA = await solicitar(t.u.id, centroA.id)
    const solB = await solicitar(t.u.id, centroB.id)
    // Sin roles vivos en ningún centro, pero la otra solicitud sigue pendiente.
    expect(await esUltimo(solA)).toBe(false)
    expect(await esUltimo(solB)).toBe(false)
    await purgar(solA)
    expect(await esUltimo(solB)).toBe(true)
    // La purga de A no se llevó la cuenta: el nombre sigue para redactar los mensajes de B.
    expect(await contenido(t.B.msg)).toContain('Tutora Dos Pendientes Olvido')
    await purgar(solB)
    expect(await contenido(t.B.msg)).toBe(`Recoge ${BORRADO}`)
  })

  it('purgarUno: invitaciones de su centro, y Auth solo con el último', async () => {
    const t = await tutoraEnDosCentros('Tutora Auth Olvido')
    const invitacion = async (centroId: string, ninoId: string) => {
      const { data, error } = await serviceClient
        .from('invitaciones')
        .insert({
          email: t.u.email,
          nombre_completo: 'Tutora Auth Olvido',
          rol_objetivo: 'tutor_legal',
          centro_id: centroId,
          nino_id: ninoId,
          tipo_vinculo: 'tutor_legal_principal',
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`invitación: ${error?.message}`)
      return data.id
    }
    const invA = await invitacion(centroA.id, t.A.nino.id)
    const invB = await invitacion(centroB.id, t.B.nino.id)
    const emailDe = async (id: string) =>
      (await serviceClient.from('invitaciones').select('email').eq('id', id).single()).data?.email

    const pendiente = (solicitudId: string, centroId: string) => ({
      solicitud_id: solicitudId,
      sujeto_tipo: 'usuario' as const,
      sujeto_id: t.u.id,
      centro_id: centroId,
      gracia_hasta: new Date().toISOString(),
    })

    await purgarUno(serviceClient, pendiente(await solicitar(t.u.id, centroA.id), centroA.id))
    expect(await emailDe(invA)).toBe(BORRADO)
    expect(await emailDe(invB)).toBe(t.u.email)
    const authTrasA = await serviceClient.auth.admin.getUserById(t.u.id)
    expect(authTrasA.data.user?.email).toBe(t.u.email)

    await purgarUno(serviceClient, pendiente(await solicitar(t.u.id, centroB.id), centroB.id))
    expect(await emailDe(invB)).toBe(BORRADO)
    const authTrasB = await serviceClient.auth.admin.getUserById(t.u.id)
    expect(authTrasB.data.user?.email).toBe(`borrado+${t.u.id}@borrado.invalid`)
  })
})
