import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * Audit log automático sobre mensajería (Fase 5).
 * Triggers `AFTER INSERT/UPDATE/DELETE` en conversaciones, mensajes y
 * anuncios usan `audit_trigger_function()` ampliada con 3 ramas:
 *   - conversaciones: centro_id directo.
 *   - mensajes:       centro_id derivado vía centro_de_conversacion.
 *   - anuncios:       centro_id directo.
 *
 * `lectura_*` NO se auditan (telemetría de usuario, decisión spec).
 */

describe('Audit log — mensajes y anuncios (Fase 5)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let profe: TestUser
  let admin: TestUser
  let convId: string
  let mensajeId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Msg')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Audit Msg')
    await matricular(nino.id, aula.id, curso.id)

    profe = await createTestUser({ nombre: 'Profe Audit Msg' })
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id)

    admin = await createTestUser({ nombre: 'Admin Audit Msg' })
    await asignarRol(admin.id, centro.id, 'admin')
  }, 90_000)

  afterAll(async () => {
    if (mensajeId) await serviceClient.from('mensajes').delete().eq('id', mensajeId)
    if (convId) await serviceClient.from('conversaciones').delete().eq('id', convId)
    await serviceClient.from('anuncios').delete().in('autor_id', [profe.id, admin.id])
    await serviceClient.from('profes_aulas').delete().in('profe_id', [profe.id])
    await serviceClient.from('roles_usuario').delete().in('usuario_id', [profe.id, admin.id])
    await deleteTestUser(profe.id)
    await deleteTestUser(admin.id)
    await serviceClient.from('matriculas').delete().eq('nino_id', nino.id)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en mensajes genera audit_log con centro_id derivado vía centro_de_conversacion', async () => {
    // Setup: conversación padre del niño (centro_id se rellena por trigger).
    const { data: conv, error: convErr } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: nino.id, centro_id: centro.id })
      .select('id, centro_id')
      .single()
    expect(convErr).toBeNull()
    expect(conv?.id).toBeTruthy()
    expect(conv?.centro_id).toBe(centro.id)
    convId = conv!.id

    // INSERT mensaje (vía service para garantizar persistencia
    // independientemente del estado de RLS).
    const { data: msg, error: msgErr } = await serviceClient
      .from('mensajes')
      .insert({
        conversacion_id: convId,
        autor_id: profe.id,
        contenido: 'mensaje de audit',
      })
      .select('id')
      .single()
    expect(msgErr).toBeNull()
    expect(msg?.id).toBeTruthy()
    mensajeId = msg!.id

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_antes, valores_despues')
      .eq('tabla', 'mensajes')
      .eq('registro_id', mensajeId)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('INSERT')
    expect(data?.centro_id).toBe(centro.id) // derivado vía centro_de_conversacion
    expect(data?.valores_antes).toBeNull()
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(despues?.contenido).toBe('mensaje de audit')
    expect(despues?.autor_id).toBe(profe.id)
    expect(despues?.erroneo).toBe(false)
  })

  it('UPDATE marcando mensaje como erróneo registra valores_antes y valores_despues', async () => {
    // Marca el mensaje creado en el test anterior como erróneo (UPDATE
    // erroneo=true + prefijo '[anulado] ' en contenido), simulando el
    // server action.
    const { error: updErr } = await serviceClient
      .from('mensajes')
      .update({ erroneo: true, contenido: '[anulado] mensaje de audit' })
      .eq('id', mensajeId)
    expect(updErr).toBeNull()

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'mensajes')
      .eq('registro_id', mensajeId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('UPDATE')
    expect(data?.centro_id).toBe(centro.id)
    const antes = data?.valores_antes as Record<string, unknown> | null
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(antes?.erroneo).toBe(false)
    expect(antes?.contenido).toBe('mensaje de audit')
    expect(despues?.erroneo).toBe(true)
    expect(despues?.contenido).toBe('[anulado] mensaje de audit')
  })

  it('INSERT en anuncios genera audit_log con centro_id directo', async () => {
    const { data: anuncio, error: anuncioErr } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: admin.id,
        centro_id: centro.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 'Anuncio de audit',
        contenido: 'contenido audit anuncio',
      })
      .select('id')
      .single()
    expect(anuncioErr).toBeNull()
    expect(anuncio?.id).toBeTruthy()

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_antes, valores_despues')
      .eq('tabla', 'anuncios')
      .eq('registro_id', anuncio!.id)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('INSERT')
    expect(data?.centro_id).toBe(centro.id)
    expect(data?.valores_antes).toBeNull()
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(despues?.titulo).toBe('Anuncio de audit')
    expect(despues?.ambito).toBe('centro')
    expect(despues?.autor_id).toBe(admin.id)
  })
})
