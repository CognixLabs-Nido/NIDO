import { createHash } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS Fase 11-A4 (RGPD) — Derecho al olvido funcional (anonimización in-place).
 *
 * Spec: docs/specs/proteccion-datos.md (Comportamiento 1, Decisiones #1/#2/#3/#5/#6/#7/F).
 * Migración: 20260614130000_phase11a4_olvido_funcional (tabla olvido_solicitudes +
 * RPCs solicitar_olvido_{nino,usuario}, olvido_pendientes, purgar_sujeto_db).
 *
 * Verifica la parte SQL (schema public): la solicitud con su gracia, la
 * anonimización in-place del niño/usuario, la redacción del audit_log, la
 * exclusión de las firmas (#7), la exclusividad de fotos (#5), la conservación de
 * contenido de mensajes con redacción de PII (#6) y la idempotencia. Las partes
 * no-SQL (Storage + auth.users) las cubre el orquestador purgarVencidos().
 *
 * Gateado por flag (migración a mano vía SQL Editor — CLI SIGILL):
 *   F11A4_OLVIDO_MIGRATION_APPLIED=1
 */

type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']

const MIGRATION_APPLIED = process.env.F11A4_OLVIDO_MIGRATION_APPLIED === '1'
const MARCA = '[borrado]'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

describe.skipIf(!MIGRATION_APPLIED)('RLS olvido funcional — F11-A4', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let adminOtro: TestUser
  let centroOtro: { id: string }

  const ninosCreados: string[] = []
  const usuariosCreados: string[] = []

  async function nuevoNino(nombre: string): Promise<string> {
    const n = await createTestNino(centro.id, nombre)
    ninosCreados.push(n.id)
    return n.id
  }

  /** Solicita olvido inmediato (gracia=0) por service-role y devuelve el id de solicitud. */
  async function solicitarNinoInmediato(ninoId: string): Promise<string> {
    const { data, error } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: ninoId,
      p_inmediato: true,
    })
    if (error) throw new Error(`solicitar_olvido_nino: ${error.message}`)
    return data as string
  }

  async function purgar(solicitudId: string) {
    const { error } = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: solicitudId })
    if (error) throw new Error(`purgar_sujeto_db: ${error.message}`)
  }

  async function ninoRow(id: string) {
    const { data } = await serviceClient.from('ninos').select('*').eq('id', id).single()
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Olvido')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Olvido')
    admin = await createTestUser({ nombre: 'Admin Olvido' })
    usuariosCreados.push(admin.id)
    await asignarRol(admin.id, centro.id, 'admin')

    centroOtro = await createTestCentro('Centro Ajeno')
    adminOtro = await createTestUser({ nombre: 'Admin Ajeno' })
    usuariosCreados.push(adminOtro.id)
    await asignarRol(adminOtro.id, centroOtro.id, 'admin')
  }, 240_000)

  afterAll(async () => {
    await serviceClient
      .from('olvido_solicitudes')
      .delete()
      .in('sujeto_id', [...ninosCreados, ...usuariosCreados])
    await serviceClient.from('media_etiquetas').delete().in('nino_id', ninosCreados)
    await serviceClient.from('mensajes').delete().in('autor_id', usuariosCreados)
    await serviceClient.from('conversaciones').delete().in('nino_id', ninosCreados)
    await serviceClient.from('publicaciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('firmas_autorizacion').delete().in('nino_id', ninosCreados)
    await serviceClient.from('autorizaciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('info_medica_emergencia').delete().in('nino_id', ninosCreados)
    await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', ninosCreados)
    await serviceClient.from('matriculas').delete().in('nino_id', ninosCreados)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', ninosCreados)
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuariosCreados)
    await serviceClient.from('push_subscriptions').delete().in('usuario_id', usuariosCreados)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuariosCreados)
    await serviceClient.from('ninos').delete().in('id', ninosCreados)
    for (const u of usuariosCreados) await deleteTestUser(u)
    await serviceClient.from('centros').delete().in('id', [centro.id, centroOtro.id])
  }, 120_000)

  // o01 — solicitud normal: soft-delete + gracia 30 días, sin purgar
  it('o01 — solicitar olvido marca deleted_at y fija gracia ≈ +30 días (pendiente)', async () => {
    const nino = await nuevoNino('Olvido Gracia')
    const { data: id, error } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: nino,
      p_inmediato: false,
    })
    expect(error).toBeNull()

    expect((await ninoRow(nino))?.deleted_at).not.toBeNull()
    const { data: sol } = await serviceClient
      .from('olvido_solicitudes')
      .select('*')
      .eq('id', id as string)
      .single()
    expect(sol?.purgado_en).toBeNull()
    const dias = (new Date(sol!.gracia_hasta).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(29)
    expect(dias).toBeLessThan(31)
  })

  // o02 — inmediato: gracia = ahora
  it('o02 — inmediato fija la gracia a ahora (purga elegible ya)', async () => {
    const nino = await nuevoNino('Olvido Inmediato')
    const id = await solicitarNinoInmediato(nino)
    const { data: sol } = await serviceClient
      .from('olvido_solicitudes')
      .select('gracia_hasta, inmediato')
      .eq('id', id)
      .single()
    expect(sol?.inmediato).toBe(true)
    expect(new Date(sol!.gracia_hasta).getTime()).toBeLessThanOrEqual(Date.now() + 2000)
  })

  // o03 — autorización: no-admin y admin de otro centro no pueden solicitar
  it('o03 — un admin de otro centro NO puede ejercer el olvido', async () => {
    const nino = await nuevoNino('Olvido Ajeno')
    const c = await clientFor(adminOtro)
    const { error } = await c.rpc('solicitar_olvido_nino', { p_nino_id: nino, p_inmediato: true })
    expect(error).not.toBeNull()
    // El niño sigue operativo (sin soft-delete).
    expect((await ninoRow(nino))?.deleted_at).toBeNull()
  })

  // o04 — purga del niño: PII directa + info médica + datos pedagógicos
  it('o04 — purgar anonimiza in-place al niño (PII, info médica clara, pedagógicos)', async () => {
    const nino = await nuevoNino('Secreto RealNombre')
    await serviceClient
      .from('ninos')
      .update({ sexo: 'F', nacionalidad: 'ES', notas_admin: 'nota sensible', foto_url: 'x/y.jpg' })
      .eq('id', nino)
    await serviceClient.from('info_medica_emergencia').insert({
      nino_id: nino,
      medicacion_habitual: 'Ibuprofeno',
      alergias_leves: 'polen',
      medico_familia: 'Dra. García',
      telefono_emergencia: '600111222',
    })
    await serviceClient.from('datos_pedagogicos_nino').insert({
      nino_id: nino,
      lactancia_estado: 'biberon',
      lactancia_observaciones: 'toma X',
      control_esfinteres: 'panal_completo',
      siesta_observaciones: 'duerme mal',
      tipo_alimentacion: 'omnivora',
      idiomas_casa: ['es'],
    })

    await purgar(await solicitarNinoInmediato(nino))

    const n = await ninoRow(nino)
    expect(n?.nombre).toBe(MARCA)
    expect(n?.apellidos).toBe(MARCA)
    expect(n?.fecha_nacimiento).toBe('1900-01-01')
    expect(n?.sexo).toBeNull()
    expect(n?.nacionalidad).toBeNull()
    expect(n?.foto_url).toBeNull()
    expect(n?.notas_admin).toBeNull()

    const { data: med } = await serviceClient
      .from('info_medica_emergencia')
      .select('medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia')
      .eq('nino_id', nino)
      .single()
    expect(med?.medicacion_habitual).toBeNull()
    expect(med?.medico_familia).toBeNull()
    expect(med?.telefono_emergencia).toBeNull()

    const { data: ped } = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('lactancia_observaciones, siesta_observaciones')
      .eq('nino_id', nino)
      .single()
    expect(ped?.lactancia_observaciones).toBeNull()
    expect(ped?.siesta_observaciones).toBeNull()
  })

  // o05 — redacción del audit_log del niño (#3)
  it('o05 — tras purgar, el audit_log del niño no conserva su PII en el jsonb', async () => {
    const nino = await nuevoNino('Audit Secreto')
    // genera un UPDATE (audit con la PII en valores_antes/despues)
    await serviceClient.from('ninos').update({ notas_admin: 'otra nota' }).eq('id', nino)

    await purgar(await solicitarNinoInmediato(nino))

    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('registro_id', nino)
    expect((filas ?? []).length).toBeGreaterThan(0)
    for (const f of filas ?? []) {
      const antes = (f.valores_antes ?? {}) as Record<string, unknown>
      const despues = (f.valores_despues ?? {}) as Record<string, unknown>
      if ('nombre' in antes) expect(antes.nombre).toBe(MARCA)
      if ('nombre' in despues) expect(despues.nombre).toBe(MARCA)
      if ('notas_admin' in antes) expect(antes.notas_admin).toBe(MARCA)
    }
  })

  // o06 — las firmas quedan EXCLUIDAS de la purga (#7, retención legal)
  it('o06 — la firma del niño permanece intacta tras la purga', async () => {
    const nino = await nuevoNino('Firma Conservada')
    const tutor = await createTestUser({ nombre: 'Tutor Firma' })
    usuariosCreados.push(tutor.id)
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await matricular(nino, aula.id, curso.id)
    await crearVinculo(nino, tutor.id, 'tutor_legal_principal', {})

    const { data: plantilla } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: true,
        titulo: 'Formato recogida',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    const { data: inst } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        plantilla_id: plantilla!.id,
        ambito: 'nino',
        nino_id: nino,
        titulo: 'Recogida',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    const firma: FirmaInsert = {
      autorizacion_id: inst!.id,
      nino_id: nino,
      firmante_id: tutor.id,
      rol_firmante: 'tutor_legal_principal',
      decision: 'firmado',
      texto_hash: sha256('Texto'),
      texto_version: 'v1',
      nombre_tecleado: 'Tutor Firma Real',
      firma_imagen: SVG,
    }
    const { data: firmaRow } = await serviceClient
      .from('firmas_autorizacion')
      .insert(firma)
      .select('id')
      .single()

    await purgar(await solicitarNinoInmediato(nino))

    const { data: f } = await serviceClient
      .from('firmas_autorizacion')
      .select('nombre_tecleado, texto_hash, decision')
      .eq('id', firmaRow!.id)
      .single()
    expect(f?.nombre_tecleado).toBe('Tutor Firma Real') // intacta (#7)
    expect(f?.texto_hash).toBe(sha256('Texto'))
  })

  // o07 — fotos: exclusiva se borra; compartida se conserva (solo se quita la etiqueta) (#5)
  it('o07 — foto exclusiva del niño se borra; foto compartida se conserva', async () => {
    const victima = await nuevoNino('Foto Victima')
    const otro = await nuevoNino('Foto Otro')

    const { data: pub } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id, texto: 'post' })
      .select('id')
      .single()

    const mkMedia = async (path: string) => {
      const { data } = await serviceClient
        .from('media')
        .insert({
          publicacion_id: pub!.id,
          centro_id: centro.id,
          bucket: 'aula-fotos',
          path,
          mime: 'image/jpeg',
        })
        .select('id')
        .single()
      return data!.id
    }
    const exclusiva = await mkMedia(`${centro.id}/excl-${victima}.jpg`)
    const compartida = await mkMedia(`${centro.id}/comp-${victima}.jpg`)
    await serviceClient.from('media_etiquetas').insert([
      { media_id: exclusiva, nino_id: victima, centro_id: centro.id },
      { media_id: compartida, nino_id: victima, centro_id: centro.id },
      { media_id: compartida, nino_id: otro, centro_id: centro.id },
    ])

    await purgar(await solicitarNinoInmediato(victima))

    // exclusiva: fila media borrada
    const { data: ex } = await serviceClient.from('media').select('id').eq('id', exclusiva)
    expect(ex ?? []).toHaveLength(0)
    // compartida: media conservada, etiqueta del 'otro' viva, etiqueta de la víctima fuera
    const { data: comp } = await serviceClient.from('media').select('id').eq('id', compartida)
    expect(comp ?? []).toHaveLength(1)
    const { data: etq } = await serviceClient
      .from('media_etiquetas')
      .select('nino_id')
      .eq('media_id', compartida)
    expect(etq?.map((e) => e.nino_id)).toEqual([otro])
  })

  // o08 — usuario: nombre tombstone, metadatos limpiados, mensajes con PII redactada (#6)
  it('o08 — purgar usuario anonimiza nombre, limpia metadatos y redacta su PII en mensajes', async () => {
    const nino = await nuevoNino('Nino Mensajes')
    const tutor = await createTestUser({ nombre: 'Nombre Secreto' })
    usuariosCreados.push(tutor.id)
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await serviceClient
      .from('usuarios')
      .update({ nombre_completo: 'Nombre Secreto' })
      .eq('id', tutor.id)

    await serviceClient.from('consentimientos').insert({
      usuario_id: tutor.id,
      tipo: 'privacidad',
      version: 'v1',
      ip_address: '10.0.0.1',
      user_agent: 'Mozilla/Test',
    })
    await serviceClient.from('push_subscriptions').insert({
      usuario_id: tutor.id,
      endpoint: `https://push.test/${tutor.id}`,
      p256dh: 'k',
      auth: 'a',
    })
    const { data: conv } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: nino, centro_id: centro.id })
      .select('id')
      .single()
    await serviceClient.from('mensajes').insert({
      conversacion_id: conv!.id,
      autor_id: tutor.id,
      contenido: 'Hola, soy Nombre Secreto y aviso de algo',
    })

    const { data: id, error } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: tutor.id,
      p_inmediato: true,
    })
    expect(error).toBeNull()
    await purgar(id as string)

    const { data: u } = await serviceClient
      .from('usuarios')
      .select('nombre_completo, deleted_at')
      .eq('id', tutor.id)
      .single()
    expect(u?.nombre_completo).toBe(MARCA)
    expect(u?.deleted_at).not.toBeNull()

    const { data: cons } = await serviceClient
      .from('consentimientos')
      .select('ip_address, user_agent')
      .eq('usuario_id', tutor.id)
    expect(cons?.every((c) => c.ip_address === null && c.user_agent === null)).toBe(true)

    const { data: subs } = await serviceClient
      .from('push_subscriptions')
      .select('id')
      .eq('usuario_id', tutor.id)
    expect(subs ?? []).toHaveLength(0)

    const { data: msgs } = await serviceClient
      .from('mensajes')
      .select('contenido')
      .eq('autor_id', tutor.id)
    // contenido conservado (dato del interlocutor) pero su nombre redactado (#6)
    expect(msgs?.[0]?.contenido).toContain(MARCA)
    expect(msgs?.[0]?.contenido).not.toContain('Nombre Secreto')
  })

  // o09 — idempotencia
  it('o09 — purgar dos veces es no-op (idempotente)', async () => {
    const nino = await nuevoNino('Idempotente')
    const id = await solicitarNinoInmediato(nino)
    await purgar(id)
    const { data: sol1 } = await serviceClient
      .from('olvido_solicitudes')
      .select('purgado_en')
      .eq('id', id)
      .single()
    await purgar(id) // segunda vez no debe fallar
    const { data: sol2 } = await serviceClient
      .from('olvido_solicitudes')
      .select('purgado_en')
      .eq('id', id)
      .single()
    expect(sol1?.purgado_en).toBe(sol2?.purgado_en) // no se re-sella
  })

  // o10 — olvido_pendientes lista solo lo vencido
  it('o10 — olvido_pendientes devuelve los vencidos y no los que están en gracia', async () => {
    const vencido = await nuevoNino('Pendiente Vencido')
    const enGracia = await nuevoNino('Pendiente Gracia')
    const idVencido = await solicitarNinoInmediato(vencido)
    await serviceClient.rpc('solicitar_olvido_nino', { p_nino_id: enGracia, p_inmediato: false })

    const { data: pend, error } = await serviceClient.rpc('olvido_pendientes')
    expect(error).toBeNull()
    const ids = (pend ?? []).map((p) => p.solicitud_id)
    expect(ids).toContain(idVencido)
    const sujetos = (pend ?? []).map((p) => p.sujeto_id)
    expect(sujetos).not.toContain(enGracia)
  })
})
