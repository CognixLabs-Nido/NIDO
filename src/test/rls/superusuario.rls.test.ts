import { createHash, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * El superusuario (20261023120100, ADR-0061).
 *
 * - platform_admins: sin policies ni permisos para la app; se pregunta con is_superadmin().
 * - es_admin: el superusuario es admin de todo centro que exista (no de uno inexistente).
 * - Lee y escribe como un admin en un centro donde no tiene ningún rol, incluidas las tres
 *   lecturas que el admin hacía como miembro (calendario laboral y menús).
 * - No es profe ni tutor.
 * - Avatares: es_admin_de_usuario / es_staff_de_usuario pasan por es_admin.
 * - La firma presencial del superusuario sincroniza el consentimiento de imagen.
 * - registrar_entrada_superusuario: una fila en audit_log con el centro y el actor, sin
 *   datos de ningún sujeto.
 *
 * La siembra y el relevo en CEI Ejemplo dependen de cuentas que la base del CI no tiene: los
 * cubre el ensayo con rollback contra producción.
 */

type Cliente = SupabaseClient<Database>
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']

const TEXTO = 'Autorizo el uso de la imagen del menor en las condiciones descritas.'
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

async function rpcBool(c: Cliente, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await (
    c.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args)
  expect(error, `${fn}: ${error?.message}`).toBeNull()
  return data as boolean
}

describe('Superusuario', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let ninoA: { id: string }
  let superU: TestUser
  let adminA: TestUser
  let adminB: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  let sinRoles: TestUser
  let cSuper: Cliente
  let cAdminA: Cliente
  let cAdminB: Cliente
  let cProfeA: Cliente
  let plantillaImg: string
  let instanciaImg: string
  const fechaB = '2031-01-02'

  beforeAll(async () => {
    centroA = await createTestCentro('Superusuario A')
    centroB = await createTestCentro('Superusuario B')
    ninoA = await createTestNino(centroA.id, 'Nino Superusuario')
    superU = await createTestUser({ nombre: 'Superusuario Pruebas' })
    adminA = await createTestUser({ nombre: 'Admin A Superusuario' })
    adminB = await createTestUser({ nombre: 'Admin B Superusuario' })
    profeA = await createTestUser({ nombre: 'Profe A Superusuario' })
    tutorA = await createTestUser({ nombre: 'Tutor A Superusuario' })
    sinRoles = await createTestUser({ nombre: 'Sin Roles Superusuario' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')

    const { error: errSuper } = await serviceClient
      .from('platform_admins')
      .insert({ usuario_id: superU.id })
    if (errSuper) throw new Error(`sembrar superusuario falló: ${errSuper.message}`)

    // Calendario laboral y menú del centro A: lo que el admin leía solo como miembro.
    await serviceClient.from('dias_centro').insert([
      { centro_id: centroA.id, fecha: '2031-01-06', tipo: 'festivo' },
      { centro_id: centroA.id, fecha: '2031-03-19', tipo: 'festivo' },
    ])
    await serviceClient
      .from('plantillas_menu_mensual')
      .insert({ centro_id: centroA.id, mes: 1, anio: 2031 })

    const { data: pl, error: errPl } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centroA.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: true,
        titulo: 'Formato imagen',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: adminA.id,
      })
      .select('id')
      .single()
    if (errPl || !pl) throw new Error(`plantilla falló: ${errPl?.message}`)
    plantillaImg = pl.id
    const { data: inst, error: errInst } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centroA.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: false,
        plantilla_id: plantillaImg,
        ambito: 'nino',
        nino_id: ninoA.id,
        firmantes_requeridos: 'uno_principal',
        titulo: 'Autorización de imágenes',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: adminA.id,
      })
      .select('id')
      .single()
    if (errInst || !inst) throw new Error(`instancia falló: ${errInst?.message}`)
    instanciaImg = inst.id

    cSuper = await clientFor(superU)
    cAdminA = await clientFor(adminA)
    cAdminB = await clientFor(adminB)
    cProfeA = await clientFor(profeA)
  }, 240_000)

  afterAll(async () => {
    const usuarios = [superU, adminA, adminB, profeA, tutorA, sinRoles]
      .filter(Boolean)
      .map((u) => u.id)
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
    if (instanciaImg) {
      await serviceClient.from('firmas_autorizacion').delete().eq('autorizacion_id', instanciaImg)
      await serviceClient.from('autorizaciones').delete().eq('id', instanciaImg)
    }
    if (plantillaImg) await serviceClient.from('autorizaciones').delete().eq('id', plantillaImg)
    for (const c of [centroA, centroB].filter(Boolean)) {
      await serviceClient.from('dias_centro').delete().eq('centro_id', c.id)
      await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', c.id)
    }
    if (ninoA) await serviceClient.from('vinculos_familiares').delete().eq('nino_id', ninoA.id)
    for (const u of usuarios) await deleteTestUser(u)
    for (const c of [centroA, centroB].filter(Boolean)) await deleteTestCentro(c.id)
  }, 120_000)

  it('premisa: el superusuario no tiene ningún rol y is_superadmin solo le dice que sí a él', async () => {
    const { data: roles } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('usuario_id', superU.id)
    expect(roles).toEqual([])
    expect(await rpcBool(cSuper, 'is_superadmin', {})).toBe(true)
    expect(await rpcBool(cAdminA, 'is_superadmin', {})).toBe(false)
  })

  it('platform_admins: la app no la lee ni la escribe, ni el superusuario ni un admin', async () => {
    for (const c of [cSuper, cAdminA]) {
      const lectura = await c.from('platform_admins').select('usuario_id')
      expect(lectura.error?.code).toBe('42501')
      const alta = await c.from('platform_admins').insert({ usuario_id: adminA.id })
      expect(alta.error?.code).toBe('42501')
      const baja = await c.from('platform_admins').delete().eq('usuario_id', superU.id)
      expect(baja.error?.code).toBe('42501')
    }
    const { data } = await serviceClient
      .from('platform_admins')
      .select('usuario_id')
      .in('usuario_id', [superU.id, adminA.id])
    expect(data).toEqual([{ usuario_id: superU.id }])
  })

  it('es_admin: el superusuario es admin de todo centro que existe, no de uno inexistente', async () => {
    expect(await rpcBool(cSuper, 'es_admin', { p_centro_id: centroA.id })).toBe(true)
    expect(await rpcBool(cSuper, 'es_admin', { p_centro_id: centroB.id })).toBe(true)
    expect(await rpcBool(cSuper, 'es_admin', { p_centro_id: randomUUID() })).toBe(false)
    expect(await rpcBool(cSuper, 'es_admin', { p_centro_id: null })).toBe(true)
    // El admin con rol, igual que antes.
    expect(await rpcBool(cAdminA, 'es_admin', { p_centro_id: centroA.id })).toBe(true)
    expect(await rpcBool(cAdminA, 'es_admin', { p_centro_id: centroB.id })).toBe(false)
  })

  it('lee lo que lee la directora del centro, también el calendario laboral y los menús', async () => {
    for (const tabla of [
      'dias_centro',
      'plantillas_menu_mensual',
      'ninos',
      'roles_usuario',
    ] as const) {
      const admin = await cAdminA.from(tabla).select('id').eq('centro_id', centroA.id)
      const sup = await cSuper.from(tabla).select('id').eq('centro_id', centroA.id)
      expect(admin.error).toBeNull()
      expect(sup.error).toBeNull()
      // Premisa: la directora ve filas (si no, la igualdad no mide nada).
      expect((admin.data ?? []).length, tabla).toBeGreaterThan(0)
      expect((sup.data ?? []).map((r) => r.id).sort(), tabla).toEqual(
        (admin.data ?? []).map((r) => r.id).sort()
      )
    }
  })

  it('escribe como admin en un centro donde no tiene rol, y queda como actor en audit_log', async () => {
    const { data, error } = await cSuper
      .from('dias_centro')
      .insert({ centro_id: centroB.id, fecha: fechaB, tipo: 'festivo' })
      .select('id')
      .single()
    expect(error).toBeNull()
    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('usuario_id, centro_id')
      .eq('tabla', 'dias_centro')
      .eq('registro_id', data!.id)
      .eq('accion', 'INSERT')
      .single()
    expect(audit).toEqual({ usuario_id: superU.id, centro_id: centroB.id })
  })

  it('no es profe ni tutor ni miembro del centro', async () => {
    expect(await rpcBool(cSuper, 'es_profe_en_centro', { p_centro_id: centroA.id })).toBe(false)
    expect(await rpcBool(cSuper, 'pertenece_a_centro', { p_centro_id: centroA.id })).toBe(false)
    expect(await rpcBool(cSuper, 'es_tutor_de', { p_nino_id: ninoA.id })).toBe(false)
    expect(await rpcBool(cSuper, 'es_tutor_legal_de', { p_nino_id: ninoA.id })).toBe(false)
  })

  it('avatares: es_admin_de_usuario y es_staff_de_usuario pasan por es_admin', async () => {
    // Superusuario: cualquier usuario con un rol vivo; uno sin roles, no.
    expect(await rpcBool(cSuper, 'es_admin_de_usuario', { p_usuario_id: tutorA.id })).toBe(true)
    expect(await rpcBool(cSuper, 'es_admin_de_usuario', { p_usuario_id: adminB.id })).toBe(true)
    expect(await rpcBool(cSuper, 'es_admin_de_usuario', { p_usuario_id: sinRoles.id })).toBe(false)
    expect(await rpcBool(cSuper, 'es_staff_de_usuario', { p_usuario_id: tutorA.id })).toBe(true)
    // Lo de antes, para quien tiene rol: la directora de A sí con los de A, no con los de B.
    expect(await rpcBool(cAdminA, 'es_admin_de_usuario', { p_usuario_id: tutorA.id })).toBe(true)
    expect(await rpcBool(cAdminA, 'es_admin_de_usuario', { p_usuario_id: adminB.id })).toBe(false)
    // La profe: staff sí, admin no.
    expect(await rpcBool(cProfeA, 'es_staff_de_usuario', { p_usuario_id: tutorA.id })).toBe(true)
    expect(await rpcBool(cProfeA, 'es_admin_de_usuario', { p_usuario_id: tutorA.id })).toBe(false)
    expect(await rpcBool(cProfeA, 'es_staff_de_usuario', { p_usuario_id: adminB.id })).toBe(false)
  })

  it('la firma presencial del superusuario sincroniza el consentimiento de imagen (la de una profe no)', async () => {
    const firma = (u: TestUser): FirmaInsert => ({
      autorizacion_id: instanciaImg,
      nino_id: ninoA.id,
      firmante_id: u.id,
      rol_firmante: 'admin',
      decision: 'firmado',
      metodo_firma: 'presencial',
      texto_hash: sha256(TEXTO),
      texto_version: 'v1',
      nombre_tecleado: 'Firmante Pruebas',
      firma_imagen: SVG_TRAZO,
    })
    const vigente = async (u: TestUser) => {
      const { data } = await serviceClient
        .from('consentimientos')
        .select('id')
        .eq('tipo', 'imagen')
        .eq('nino_id', ninoA.id)
        .eq('usuario_id', u.id)
        .is('revocado_en', null)
      return (data ?? []).length
    }
    // La firma presencial la escribe el servidor (como en la app): aquí, con service role.
    expect((await serviceClient.from('firmas_autorizacion').insert(firma(profeA))).error).toBeNull()
    expect(await vigente(profeA)).toBe(0)
    expect((await serviceClient.from('firmas_autorizacion').insert(firma(superU))).error).toBeNull()
    expect(await vigente(superU)).toBe(1)
  })

  describe('registrar_entrada_superusuario', () => {
    it('deja una fila con el centro y el actor, sin datos de ningún sujeto', async () => {
      const antes = new Date(Date.now() - 1000).toISOString()
      const { error } = await cSuper.rpc('registrar_entrada_superusuario', {
        p_centro_id: centroA.id,
      })
      expect(error).toBeNull()
      const { data } = await serviceClient
        .from('audit_log')
        .select(
          'tabla, registro_id, accion, usuario_id, centro_id, valores_antes, valores_despues, actor_sistema'
        )
        .eq('tabla', 'entrada_superusuario')
        .eq('usuario_id', superU.id)
        .gte('ts', antes)
      expect(data).toEqual([
        {
          tabla: 'entrada_superusuario',
          registro_id: centroA.id,
          accion: 'INSERT',
          usuario_id: superU.id,
          centro_id: centroA.id,
          valores_antes: null,
          valores_despues: null,
          actor_sistema: null,
        },
      ])
    })

    it('la ve la directora de ese centro; la de otro centro no', async () => {
      const deA = await cAdminA
        .from('audit_log')
        .select('id')
        .eq('tabla', 'entrada_superusuario')
        .eq('centro_id', centroA.id)
      expect((deA.data ?? []).length).toBeGreaterThan(0)
      const deB = await cAdminB
        .from('audit_log')
        .select('id')
        .eq('tabla', 'entrada_superusuario')
        .eq('centro_id', centroA.id)
      expect(deB.data).toEqual([])
    })

    it('solo el superusuario, y solo a un centro que existe', async () => {
      const admin = await cAdminA.rpc('registrar_entrada_superusuario', { p_centro_id: centroA.id })
      expect(admin.error?.code).toBe('42501')
      const inexistente = await cSuper.rpc('registrar_entrada_superusuario', {
        p_centro_id: randomUUID(),
      })
      expect(inexistente.error?.code).toBe('P0002')
    })
  })
})
