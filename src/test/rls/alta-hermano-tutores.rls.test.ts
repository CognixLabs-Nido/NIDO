import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Alta del 2.º hijo — `crear_o_anadir_a_familia` (20261002130000, marcas [ALTA-HERMANO Cn]).
 *
 *  - C3: hermano en familia existente → el niño nuevo queda vinculado a TODOS los tutores
 *    con cuenta de la familia, cada uno con su papel (titular → principal, segundo_tutor →
 *    secundario) y el parentesco/permisos de su vínculo activo con otro hijo.
 *  - C2: el tutor que recibe la RPC queda con el tipo de SU papel (si es el segundo_tutor,
 *    secundario; antes se forzaba a principal).
 *  - C1: sin nombre con el que comparar (Invitar manda '') no hay colisión; la colisión real
 *    (mismo email, otro nombre) se mantiene.
 *  - El 2.º tutor sin cuenta no se toca (lo vincula accept-invitation); el que tiene el rol
 *    tutor_legal retirado NO recupera acceso.
 *  - Regresión: primer hijo (familia nueva) → 'familia_creada' con un solo vínculo principal.
 *
 * Gate: ALTA_HERMANO_TUTORES_APPLIED=1 (requiere 20261002130000).
 */

const APPLIED = process.env.ALTA_HERMANO_TUTORES_APPLIED === '1'

const NACIMIENTO = '2024-03-15'

type Vinculo = { usuario_id: string; tipo_vinculo: string; parentesco: string; permisos: unknown }

interface Familia {
  centroId: string
  aulaId: string
  familiaId: string
  t1: TestUser
  t2: TestUser
}

describe.skipIf(!APPLIED)('Alta del 2.º hijo — la RPC vincula a todos los tutores', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin Hermano' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  async function nuevoCentro(): Promise<{ centroId: string; aulaId: string; cursoId: string }> {
    const centro = await createTestCentro('Centro Hermano')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    return { centroId: centro.id, aulaId: aula.id, cursoId: curso.id }
  }

  async function usuario(nombre: string, centroId: string): Promise<TestUser> {
    const u = await createTestUser({ nombre })
    usuarios.push(u.id)
    await asignarRol(u.id, centroId, 'tutor_legal')
    return u
  }

  /** Familia con T1 (titular, madre) y T2 (segundo_tutor, padre), ambos con cuenta y vínculo al 1.er hijo. */
  async function familiaConDosTutores(): Promise<Familia> {
    const { centroId, aulaId, cursoId } = await nuevoCentro()
    const t1 = await usuario('Tutor Uno', centroId)
    const t2 = await usuario('Tutor Dos', centroId)
    const familiaId = await createTestFamilia(centroId)
    await serviceClient.from('familia_tutores').insert([
      {
        familia_id: familiaId,
        usuario_id: t1.id,
        rol_familia: 'titular',
        email: t1.email,
        nombre_completo: 'Tutor Uno',
      },
      {
        familia_id: familiaId,
        usuario_id: t2.id,
        rol_familia: 'segundo_tutor',
        email: t2.email,
        nombre_completo: 'Tutor Dos',
      },
    ])
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        nombre: 'Primer Hijo',
        apellidos: 'Test',
        fecha_nacimiento: NACIMIENTO,
      })
      .select('id')
      .single()
    await serviceClient.from('matriculas').insert({
      nino_id: nino!.id,
      aula_id: aulaId,
      curso_academico_id: cursoId,
      fecha_alta: '2025-09-01',
    })
    await crearVinculo(nino!.id, t1.id, 'tutor_legal_principal')
    await serviceClient.from('vinculos_familiares').insert({
      nino_id: nino!.id,
      usuario_id: t2.id,
      tipo_vinculo: 'tutor_legal_secundario',
      parentesco: 'padre',
      permisos: { puede_ver_agenda: true, puede_recibir_mensajes: false },
    })
    return { centroId, aulaId, familiaId, t1, t2 }
  }

  function alta(
    centroId: string,
    aulaId: string,
    tutor: { email: string; nombre: string; usuarioId: string | null }
  ) {
    return cAdmin.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Hermano',
      p_apellidos_nino: 'Test',
      p_fecha_nacimiento: NACIMIENTO,
      p_centro_id: centroId,
      p_aula_id: aulaId,
      p_tutor_email: tutor.email,
      p_tutor_nombre_completo: tutor.nombre,
      p_parentesco: tutor.usuarioId ? 'madre' : '',
      p_descripcion_parentesco: '',
      p_usuario_id: tutor.usuarioId as string,
      p_permisos: {},
    })
  }

  async function vinculosDe(ninoId: string): Promise<Vinculo[]> {
    const { data } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo, parentesco, permisos')
      .eq('nino_id', ninoId)
      .is('deleted_at', null)
    return (data ?? []) as Vinculo[]
  }

  function resultado(data: unknown): { resultado: string; familia_id: string; nino_id: string } {
    return data as { resultado: string; familia_id: string; nino_id: string }
  }

  it('hermano por T1: queda vinculado a T1 (principal) y a T2 (secundario, con su parentesco y permisos)', async () => {
    const f = await familiaConDosTutores()
    const { data, error } = await alta(f.centroId, f.aulaId, {
      email: f.t1.email,
      nombre: 'Tutor Uno',
      usuarioId: f.t1.id,
    })
    expect(error).toBeNull()
    const r = resultado(data)
    expect(r.resultado).toBe('nino_anadido')
    expect(r.familia_id).toBe(f.familiaId)

    const vs = await vinculosDe(r.nino_id)
    expect(vs).toHaveLength(2)
    const v1 = vs.find((v) => v.usuario_id === f.t1.id)
    const v2 = vs.find((v) => v.usuario_id === f.t2.id)
    expect(v1?.tipo_vinculo).toBe('tutor_legal_principal')
    expect(v2?.tipo_vinculo).toBe('tutor_legal_secundario')
    expect(v2?.parentesco).toBe('padre')
    expect(v2?.permisos).toEqual({ puede_ver_agenda: true, puede_recibir_mensajes: false })
  }, 60_000)

  it('hermano por T2: T2 queda secundario (su papel) y T1 principal', async () => {
    const f = await familiaConDosTutores()
    const { data, error } = await alta(f.centroId, f.aulaId, {
      email: f.t2.email,
      nombre: 'Tutor Dos',
      usuarioId: f.t2.id,
    })
    expect(error).toBeNull()
    const r = resultado(data)
    expect(r.familia_id).toBe(f.familiaId)

    const vs = await vinculosDe(r.nino_id)
    expect(vs).toHaveLength(2)
    expect(vs.find((v) => v.usuario_id === f.t2.id)?.tipo_vinculo).toBe('tutor_legal_secundario')
    expect(vs.find((v) => v.usuario_id === f.t1.id)?.tipo_vinculo).toBe('tutor_legal_principal')
  }, 60_000)

  it('el 2.º tutor con el rol tutor_legal retirado NO recupera acceso por el hermano', async () => {
    const f = await familiaConDosTutores()
    await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'baja_nino' })
      .eq('usuario_id', f.t2.id)
      .eq('centro_id', f.centroId)
    const { data, error } = await alta(f.centroId, f.aulaId, {
      email: f.t1.email,
      nombre: 'Tutor Uno',
      usuarioId: f.t1.id,
    })
    expect(error).toBeNull()
    const vs = await vinculosDe(resultado(data).nino_id)
    expect(vs.map((v) => v.usuario_id)).toEqual([f.t1.id])
  }, 60_000)

  it('el 2.º tutor SIN cuenta no se vincula (lo hará accept-invitation)', async () => {
    const { centroId, aulaId, cursoId } = await nuevoCentro()
    const t1 = await usuario('Titular Solo', centroId)
    const familiaId = await createTestFamilia(centroId)
    await serviceClient.from('familia_tutores').insert([
      {
        familia_id: familiaId,
        usuario_id: t1.id,
        rol_familia: 'titular',
        email: t1.email,
        nombre_completo: 'Titular Solo',
      },
      {
        familia_id: familiaId,
        usuario_id: null,
        rol_familia: 'segundo_tutor',
        email: `sin-cuenta-${t1.id}@nido.test`,
        nombre_completo: 'Sin Cuenta',
      },
    ])
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        nombre: 'Primer Hijo',
        apellidos: 'Test',
        fecha_nacimiento: NACIMIENTO,
      })
      .select('id')
      .single()
    await serviceClient.from('matriculas').insert({
      nino_id: nino!.id,
      aula_id: aulaId,
      curso_academico_id: cursoId,
      fecha_alta: '2025-09-01',
    })
    await crearVinculo(nino!.id, t1.id, 'tutor_legal_principal')

    const { data, error } = await alta(centroId, aulaId, {
      email: t1.email,
      nombre: 'Titular Solo',
      usuarioId: t1.id,
    })
    expect(error).toBeNull()
    const vs = await vinculosDe(resultado(data).nino_id)
    expect(vs.map((v) => [v.usuario_id, v.tipo_vinculo])).toEqual([
      [t1.id, 'tutor_legal_principal'],
    ])
  }, 60_000)

  it('Invitar (sin nombre) con el email de un titular stub ya no da colisión: mismo hermano en la misma familia', async () => {
    const { centroId, aulaId } = await nuevoCentro()
    const familiaId = await createTestFamilia(centroId)
    const email = `stub-${familiaId}@nido.test`
    await serviceClient.from('familia_tutores').insert({
      familia_id: familiaId,
      usuario_id: null,
      rol_familia: 'titular',
      email,
      nombre_completo: 'Stub Uno',
    })
    const { data, error } = await alta(centroId, aulaId, { email, nombre: '', usuarioId: null })
    expect(error).toBeNull()
    const r = resultado(data)
    expect(r.resultado).toBe('nino_anadido')
    expect(r.familia_id).toBe(familiaId)
  }, 60_000)

  it('la colisión real (mismo email, otro nombre) se mantiene', async () => {
    const { centroId, aulaId } = await nuevoCentro()
    const familiaId = await createTestFamilia(centroId)
    const email = `colision-${familiaId}@nido.test`
    await serviceClient.from('familia_tutores').insert({
      familia_id: familiaId,
      usuario_id: null,
      rol_familia: 'titular',
      email,
      nombre_completo: 'Stub Uno',
    })
    const { data, error } = await alta(centroId, aulaId, {
      email,
      nombre: 'Otra Persona',
      usuarioId: null,
    })
    expect(error).toBeNull()
    expect(resultado(data).resultado).toBe('colision')
  }, 60_000)

  it('regresión primer hijo: familia nueva con un solo vínculo principal', async () => {
    const { centroId, aulaId } = await nuevoCentro()
    const nueva = await usuario('Nueva Madre', centroId)
    const { data, error } = await alta(centroId, aulaId, {
      email: nueva.email,
      nombre: 'Nueva Madre',
      usuarioId: nueva.id,
    })
    expect(error).toBeNull()
    const r = resultado(data)
    expect(r.resultado).toBe('familia_creada')
    const vs = await vinculosDe(r.nino_id)
    expect(vs.map((v) => [v.usuario_id, v.tipo_vinculo])).toEqual([
      [nueva.id, 'tutor_legal_principal'],
    ])
  }, 60_000)
})
