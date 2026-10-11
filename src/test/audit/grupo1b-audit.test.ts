import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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
  serviceClient,
  type TestNino,
  type TestUser,
} from '../rls/setup'

/**
 * Auditoría del Grupo 1, PR B.
 *
 * Hueco de la purga: `purgar_sujeto_db`, al purgar un usuario, hace UPDATE de `mensajes`
 * (quita su nombre del contenido) y de `vinculos_familiares` (`descripcion_parentesco`). Esos
 * UPDATE escriben filas de `audit_log` con el id del mensaje o del vínculo, que la redacción
 * (`registro_id = sujeto OR usuario_id = sujeto`) no alcanza: la purga dejaba en audit_log el
 * dato que borra.
 *
 * Además (20261011130000):
 *  - `invitaciones` se audita SIN `token`; su email y su nombre se redactan al purgar al
 *    usuario (tras el paso 4 de purgar-vencidos.ts) y al purgar un esqueleto huérfano;
 *  - `audit_log.actor_sistema`: sin humano, la etiqueta de la purga o `system:service_role`;
 *    con sesión humana, NULL.
 *
 * Principio: nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
 */
const APPLIED = process.env.AUDITORIA_GRUPO1B_APPLIED === '1'

const NOMBRE = 'Nombre Fuga Grupo1B'
const PARENTESCO = 'Parentesco Fuga Grupo1B'

describe.skipIf(!APPLIED)('Audit log — Grupo 1, PR B', () => {
  let centro: { id: string }
  let nino: TestNino
  let sujeto: TestUser
  let otro: TestUser
  let admin: TestUser
  let curso: { id: string }
  let aula: { id: string }
  let conversacionId: string | null = null
  const solicitudes: string[] = []
  const usuariosExtra: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Grupo1B')
    nino = await createTestNino(centro.id)
    sujeto = await createTestUser({ nombre: NOMBRE })
    otro = await createTestUser({ nombre: 'Profe Grupo1B' })
    await asignarRol(sujeto.id, centro.id, 'tutor_legal')
    await asignarRol(otro.id, centro.id, 'profe')
    admin = await createTestUser({ nombre: 'Admin Grupo1B' })
    await asignarRol(admin.id, centro.id, 'admin')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await serviceClient.from('mensajes').delete().in('autor_id', [sujeto.id, otro.id])
    if (conversacionId) await serviceClient.from('conversaciones').delete().eq('id', conversacionId)
    for (const u of [sujeto, otro, admin]) await deleteTestUser(u.id)
    for (const u of usuariosExtra) await deleteTestUser(u)
    await deleteTestCentro(centro.id)
  }, 120_000)

  it('la purga de un usuario no deja en audit_log su nombre (mensajes) ni su parentesco (vínculos)', async () => {
    await serviceClient.from('usuarios').update({ nombre_completo: NOMBRE }).eq('id', sujeto.id)

    const vinculoId = await crearVinculo(nino.id, sujeto.id, 'tutor_legal_principal')
    const { error: vErr } = await serviceClient
      .from('vinculos_familiares')
      .update({ descripcion_parentesco: PARENTESCO })
      .eq('id', vinculoId)
    expect(vErr).toBeNull()

    const { data: conv, error: cErr } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: nino.id, centro_id: centro.id })
      .select('id')
      .single()
    expect(cErr).toBeNull()
    conversacionId = conv!.id
    // Un mensaje de OTRA persona que nombra al sujeto: su fila de auditoría no lleva el uid del
    // sujeto en ninguna parte.
    const { data: msg, error: mErr } = await serviceClient
      .from('mensajes')
      .insert({
        conversacion_id: conversacionId,
        autor_id: otro.id,
        contenido: `Hoy recoge ${NOMBRE} a las cinco`,
      })
      .select('id')
      .single()
    expect(mErr).toBeNull()

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: sujeto.id,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    // La propia tabla queda limpia (lo que ya hacía la purga).
    const { data: m } = await serviceClient
      .from('mensajes')
      .select('contenido')
      .eq('id', msg!.id)
      .single()
    expect(m?.contenido).not.toContain(NOMBRE)

    // Y audit_log también.
    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, registro_id, valores_antes, valores_despues')
      .in('registro_id', [msg!.id, vinculoId])
    const resumen = (f: NonNullable<typeof filas>[number]) => {
      const a = (f.valores_antes ?? {}) as Record<string, unknown>
      const d = (f.valores_despues ?? {}) as Record<string, unknown>
      return {
        tabla: f.tabla,
        accion: f.accion,
        antes: a.contenido ?? a.descripcion_parentesco ?? null,
        despues: d.contenido ?? d.descripcion_parentesco ?? null,
      }
    }
    // Ensayo de cierre: las filas de auditoría del mensaje y del vínculo tras la purga, todas.
    console.warn('CIERRE audit_log tras la purga:', JSON.stringify((filas ?? []).map(resumen)))
    const fugas = (filas ?? []).filter((f) => {
      const t = JSON.stringify([f.valores_antes, f.valores_despues])
      return t.includes(NOMBRE) || t.includes(PARENTESCO)
    })
    if (fugas.length > 0) {
      console.error('FUGA en audit_log tras la purga:', JSON.stringify(fugas.map(resumen)))
    }
    expect(fugas).toEqual([])
  })

  it('invitaciones: se audita con su centro y sin token; actor system:service_role', async () => {
    const email = `g1b-inv-${randomUUID().slice(0, 8)}@nido.test`
    const { data, error } = await serviceClient
      .from('invitaciones')
      .insert({
        email,
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        nino_id: nino.id,
        tipo_vinculo: 'tutor_legal_principal',
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      })
      .select('id, token')
      .single()
    expect(error).toBeNull()

    const { data: fila } = await serviceClient
      .from('audit_log')
      .select('centro_id, usuario_id, actor_sistema, valores_despues')
      .eq('tabla', 'invitaciones')
      .eq('registro_id', data!.id)
      .eq('accion', 'INSERT')
      .single()
    expect(fila?.centro_id).toBe(centro.id)
    expect(fila?.usuario_id).toBeNull()
    expect(fila?.actor_sistema).toBe('system:service_role')
    const despues = fila?.valores_despues as Record<string, unknown>
    expect(despues.email).toBe(email)
    expect(despues).not.toHaveProperty('token')
    expect(JSON.stringify(despues)).not.toContain(String(data!.token))
  })

  it('actor_sistema: con sesión humana queda NULL y manda usuario_id', async () => {
    const cAdmin = await clientFor(admin)
    const { error } = await cAdmin
      .from('aulas')
      .update({ descripcion: 'Editada por la directora' })
      .eq('id', aula.id)
    expect(error).toBeNull()
    const { data: fila } = await serviceClient
      .from('audit_log')
      .select('usuario_id, actor_sistema')
      .eq('tabla', 'aulas')
      .eq('registro_id', aula.id)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(fila?.usuario_id).toBe(admin.id)
    expect(fila?.actor_sistema).toBeNull()
  })

  it('actor_sistema: el CHECK rechaza lo que no empieza por system:', async () => {
    const { error } = await serviceClient
      .from('audit_log')
      .insert({ tabla: 'prueba_g1b', accion: 'INSERT', actor_sistema: 'humano' })
    expect(error?.code).toBe('23514')
  })

  it('invitaciones: la purga del usuario redacta email y nombre en audit_log; actor de la purga', async () => {
    const nombre = 'Invitado Purgable Grupo1B'
    const u = await createTestUser({ nombre })
    usuariosExtra.push(u.id)
    await asignarRol(u.id, centro.id, 'tutor_legal')
    const { data: inv, error: iErr } = await serviceClient
      .from('invitaciones')
      .insert({
        email: u.email,
        nombre_completo: nombre,
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        nino_id: nino.id,
        tipo_vinculo: 'tutor_legal_principal',
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      })
      .select('id')
      .single()
    expect(iErr).toBeNull()

    // Paso 4 de purgar-vencidos.ts, tal cual.
    await serviceClient
      .from('invitaciones')
      .update({ email: '[borrado]', nombre_completo: '[borrado]' })
      .ilike('email', u.email)

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: u.id,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('tabla', 'invitaciones')
      .eq('registro_id', inv!.id)
    expect(filas?.length).toBeGreaterThanOrEqual(2)
    const json = JSON.stringify(filas)
    expect(json).not.toContain(u.email)
    expect(json).not.toContain(nombre)

    const { data: filaUsuario } = await serviceClient
      .from('audit_log')
      .select('usuario_id, actor_sistema, valores_despues')
      .eq('tabla', 'usuarios')
      .eq('registro_id', u.id)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(filaUsuario?.usuario_id).toBeNull()
    expect(filaUsuario?.actor_sistema).toBe('system:purgar_sujeto_db')
  })

  it('invitaciones: la purga de un esqueleto huérfano redacta las que caen en cascada', async () => {
    const huerfano = await createTestNino(centro.id, 'Esqueleto Grupo1B')
    const { error: mErr } = await serviceClient.from('matriculas').insert({
      nino_id: huerfano.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      estado: 'pendiente',
    })
    expect(mErr).toBeNull()
    const email = `g1b-esq-${randomUUID().slice(0, 8)}@nido.test`
    const nombre = 'Invitado Esqueleto Grupo1B'
    const { data: inv, error: iErr } = await serviceClient
      .from('invitaciones')
      .insert({
        email,
        nombre_completo: nombre,
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        nino_id: huerfano.id,
        tipo_vinculo: 'tutor_legal_principal',
        expires_at: new Date(Date.now() - 40 * 864e5).toISOString(),
      })
      .select('id')
      .single()
    expect(iErr).toBeNull()

    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString()
    const { error } = await serviceClient.rpc('purgar_esqueleto_huerfano_nino', {
      p_nino_id: huerfano.id,
      p_cutoff: cutoff,
    })
    expect(error).toBeNull()

    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues')
      .eq('tabla', 'invitaciones')
      .eq('registro_id', inv!.id)
    expect(filas?.map((f) => f.accion).sort()).toEqual(['DELETE', 'INSERT'])
    const json = JSON.stringify(filas)
    expect(json).not.toContain(email)
    expect(json).not.toContain(nombre)

    const { data: filaNino } = await serviceClient
      .from('audit_log')
      .select('actor_sistema')
      .eq('tabla', 'ninos')
      .eq('registro_id', huerfano.id)
      .eq('accion', 'DELETE')
      .single()
    expect(filaNino?.actor_sistema).toBe('system:purgar_esqueleto_huerfano_nino')
  })
})
