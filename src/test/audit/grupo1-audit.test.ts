import { randomUUID } from 'node:crypto'

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
  serviceClient,
  type TestNino,
  type TestUser,
} from '../rls/setup'

/**
 * Auditoría del Grupo 1 (PR A, `20261011120000_feat_auditoria_ocho_tablas`).
 *
 * 8 tablas más con `audit_trigger_function()`:
 *  - profes_aulas: centro_id derivado del aula; si el aula ya no está (DELETE en cascada al
 *    borrar el aula), del curso.
 *  - aulas, cursos_academicos, tarifa_concepto_anio, acuses_alta: centro_id directo.
 *  - cambios_pendientes: centro_id directo, SIN payload ni valor_propuesto.
 *  - mandatos_sepa: centro_id directo, SIN iban_cifrado, firma_imagen, titular,
 *    nombre_tecleado, ip_address ni user_agent.
 *  - usuarios: centro_id NULL (no es de un centro); la purga RGPD redacta nombre_completo.
 *
 * Principio: nada entra en audit_log que la redacción de la purga no sepa limpiar.
 */
const APPLIED = process.env.AUDITORIA_GRUPO1_APPLIED === '1'

type Fila = {
  accion: string
  centro_id: string | null
  valores_antes: Record<string, unknown> | null
  valores_despues: Record<string, unknown> | null
}

async function auditDe(tabla: string, registroId: string, accion: string): Promise<Fila> {
  const { data, error } = await serviceClient
    .from('audit_log')
    .select('accion, centro_id, valores_antes, valores_despues')
    .eq('tabla', tabla)
    .eq('registro_id', registroId)
    .eq('accion', accion as 'INSERT' | 'UPDATE' | 'DELETE')
    .order('ts', { ascending: false })
    .limit(1)
    .single()
  expect(error).toBeNull()
  return data as Fila
}

describe.skipIf(!APPLIED)('Audit log — Grupo 1 (8 tablas)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: TestNino
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  const usuariosExtra: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Grupo1')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id)
    admin = await createTestUser({ nombre: 'Admin Audit Grupo1' })
    profe = await createTestUser({ nombre: 'Profe Audit Grupo1' })
    tutor = await createTestUser({ nombre: 'Tutor Audit Grupo1' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
  }, 120_000)

  afterAll(async () => {
    await serviceClient
      .from('olvido_solicitudes')
      .delete()
      .in('sujeto_id', usuariosExtra.length ? usuariosExtra : [randomUUID()])
    await serviceClient.from('cambios_pendientes').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await serviceClient.from('acuses_alta').delete().eq('centro_id', centro.id)
    await serviceClient.from('tarifa_concepto_anio').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    for (const u of [admin, profe, tutor]) await deleteTestUser(u.id)
    for (const u of usuariosExtra) await deleteTestUser(u)
    await deleteTestCentro(centro.id)
  }, 120_000)

  it('aulas: INSERT y UPDATE con centro_id', async () => {
    const ins = await auditDe('aulas', aula.id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.centro_id).toBe(centro.id)

    const { error } = await serviceClient
      .from('aulas')
      .update({ descripcion: 'Aula auditada' })
      .eq('id', aula.id)
    expect(error).toBeNull()
    const upd = await auditDe('aulas', aula.id, 'UPDATE')
    expect(upd.centro_id).toBe(centro.id)
    expect(upd.valores_despues?.descripcion).toBe('Aula auditada')
  })

  it('cursos_academicos: INSERT con centro_id', async () => {
    const ins = await auditDe('cursos_academicos', curso.id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.estado).toBe('activo')
  })

  it('profes_aulas: INSERT y DELETE con el centro del aula', async () => {
    const id = await asignarProfeAula(profe.id, aula.id, curso.id)
    const ins = await auditDe('profes_aulas', id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.profe_id).toBe(profe.id)

    const { error } = await serviceClient.from('profes_aulas').delete().eq('id', id)
    expect(error).toBeNull()
    const del = await auditDe('profes_aulas', id, 'DELETE')
    expect(del.centro_id).toBe(centro.id)
    expect(del.valores_antes?.aula_id).toBe(aula.id)
  })

  it('profes_aulas: el DELETE en cascada al borrar el aula toma el centro del curso', async () => {
    const otraAula = await createTestAula(centro.id, curso.id)
    const id = await asignarProfeAula(profe.id, otraAula.id, curso.id)

    const { error } = await serviceClient.from('aulas').delete().eq('id', otraAula.id)
    expect(error).toBeNull()
    const del = await auditDe('profes_aulas', id, 'DELETE')
    expect(del.centro_id).toBe(centro.id)
  })

  it('tarifa_concepto_anio: INSERT con centro_id', async () => {
    const { data: concepto, error: cErr } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Escolaridad audit',
        tipo_concepto: 'mensual',
        activo: true,
        signo: 1,
        ambito: 'nino',
        aplicacion: 'automatico',
        tipo_valor: 'fijo',
        importe_centimos: 10000,
        tarifa_por_anio_nacimiento: true,
      })
      .select('id')
      .single()
    expect(cErr).toBeNull()

    const { data, error } = await serviceClient
      .from('tarifa_concepto_anio')
      .insert({
        centro_id: centro.id,
        concepto_id: concepto!.id,
        anio_nacimiento: 2024,
        importe_centimos: 12345,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const ins = await auditDe('tarifa_concepto_anio', data!.id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.importe_centimos).toBe(12345)
  })

  it('acuses_alta: INSERT con centro_id', async () => {
    const { data, error } = await serviceClient
      .from('acuses_alta')
      .insert({ nino_id: nino.id, centro_id: centro.id, tipo: 'normas', firmante_id: tutor.id })
      .select('id')
      .single()
    expect(error).toBeNull()
    const ins = await auditDe('acuses_alta', data!.id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.tipo).toBe('normas')
  })

  it('cambios_pendientes: audita estado y revisor, nunca el contenido del cambio', async () => {
    const secreto = 'Calle Secreta Auditoria 1'
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        entidad: 'ninos',
        registro_id: nino.id,
        payload: { direccion: secreto },
        valor_propuesto: { direccion: secreto },
        solicitado_por: tutor.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const id = data!.id

    const ins = await auditDe('cambios_pendientes', id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.estado).toBe('pendiente')
    expect(ins.valores_despues).not.toHaveProperty('payload')
    expect(ins.valores_despues).not.toHaveProperty('valor_propuesto')

    const { error: uErr } = await serviceClient
      .from('cambios_pendientes')
      .update({ estado: 'aprobado', revisado_por: admin.id, decided_at: new Date().toISOString() })
      .eq('id', id)
    expect(uErr).toBeNull()
    const upd = await auditDe('cambios_pendientes', id, 'UPDATE')
    expect(upd.valores_despues?.estado).toBe('aprobado')
    expect(upd.valores_despues?.revisado_por).toBe(admin.id)
    for (const v of [upd.valores_antes, upd.valores_despues]) {
      expect(v).not.toHaveProperty('payload')
      expect(v).not.toHaveProperty('valor_propuesto')
    }

    const { data: todas } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('tabla', 'cambios_pendientes')
      .eq('registro_id', id)
    expect(todas?.length).toBe(2)
    expect(JSON.stringify(todas)).not.toContain(secreto)
  })

  it('mandatos_sepa: audita el estado, sin IBAN cifrado, firma ni datos del firmante', async () => {
    const titular = 'Titular Secreto Auditoria'
    const { data, error } = await serviceClient
      .from('mandatos_sepa')
      .insert({
        centro_id: centro.id,
        familia_id: nino.familia_id,
        nino_id: nino.id,
        usuario_id: tutor.id,
        iban_cifrado: '\\x00',
        iban_ultimos4: '1234',
        titular,
        nombre_tecleado: titular,
        firma_imagen: 'data:image/png;base64,AAAA',
        ip_address: '10.0.0.9',
        user_agent: 'Agente Secreto',
        identificador_mandato: `NIDO-AUDIT-${randomUUID().slice(0, 8)}`,
        estado: 'activo',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const id = data!.id

    const ins = await auditDe('mandatos_sepa', id, 'INSERT')
    expect(ins.centro_id).toBe(centro.id)
    expect(ins.valores_despues?.estado).toBe('activo')
    expect(ins.valores_despues?.iban_ultimos4).toBe('1234')
    for (const k of [
      'iban_cifrado',
      'firma_imagen',
      'titular',
      'nombre_tecleado',
      'ip_address',
      'user_agent',
    ]) {
      expect(ins.valores_despues).not.toHaveProperty(k)
    }

    const { error: uErr } = await serviceClient
      .from('mandatos_sepa')
      .update({ estado: 'revocado' })
      .eq('id', id)
    expect(uErr).toBeNull()
    const upd = await auditDe('mandatos_sepa', id, 'UPDATE')
    expect(upd.valores_antes?.estado).toBe('activo')
    expect(upd.valores_despues?.estado).toBe('revocado')

    const { data: todas } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('tabla', 'mandatos_sepa')
      .eq('registro_id', id)
    const json = JSON.stringify(todas)
    expect(json).not.toContain(titular)
    expect(json).not.toContain('Agente Secreto')
    expect(json).not.toContain('10.0.0.9')
    expect(json).not.toContain('base64')
  })

  it('usuarios: INSERT y UPDATE con centro_id NULL', async () => {
    const ins = await auditDe('usuarios', tutor.id, 'INSERT')
    expect(ins.centro_id).toBeNull()
    expect(ins.valores_despues).not.toHaveProperty('email')

    const { error } = await serviceClient
      .from('usuarios')
      .update({ idioma_preferido: 'va' })
      .eq('id', tutor.id)
    expect(error).toBeNull()
    const upd = await auditDe('usuarios', tutor.id, 'UPDATE')
    expect(upd.centro_id).toBeNull()
    expect(upd.valores_despues?.idioma_preferido).toBe('va')
  })

  it('usuarios: la purga RGPD redacta el nombre en todas sus filas de auditoría', async () => {
    const nombre = 'Nombre Purgable Auditoria'
    const u = await createTestUser({ nombre })
    usuariosExtra.push(u.id)
    await asignarRol(u.id, centro.id, 'tutor_legal')
    await serviceClient.from('usuarios').update({ nombre_completo: nombre }).eq('id', u.id)

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: u.id,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('tabla', 'usuarios')
      .eq('registro_id', u.id)
    expect(filas?.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(filas)).not.toContain(nombre)
  })
})
