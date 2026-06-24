import { randomUUID } from 'crypto'

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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS del blog del aula (F10-0) + políticas de Storage. Cubre (spec
 * docs/specs/fotos-publicaciones.md, ADR-0045):
 *  - escribir publicaciones: coordinadora/profesora/admin del aula (P5); tecnico/apoyo
 *    y profe de otra aula NO. `.insert().select()` (gotcha MVCC, helper row-aware).
 *  - leer: familia con `puede_ver_fotos` ve TODO el blog del aula (P2); sin el permiso
 *    NO; aislamiento entre aulas/centros.
 *  - etiquetar: solo niños con `puede_aparecer_en_fotos` (P2). Revocar OCULTA la
 *    publicación a la familia.
 *  - borrado real por autor/admin.
 *  - Storage: subir a aula-fotos solo redactor/admin del aula.
 *
 * **Gated** por `F10_0_MIGRATION_APPLIED=1` (incluye buckets + políticas de Storage,
 * aplicadas a mano por SQL Editor — CLI SIGILL). Comando:
 *   F10_0_MIGRATION_APPLIED=1 npm run test:rls -- publicaciones.rls
 */
const MIGRATION_APPLIED = process.env.F10_0_MIGRATION_APPLIED === '1'

type TipoPersonalAula = Database['public']['Enums']['tipo_personal_aula']
type MediaInsert = Database['public']['Tables']['media']['Insert']

describe.skipIf(!MIGRATION_APPLIED)('RLS blog del aula — F10-0', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }

  let admin: TestUser
  let coordinadora: TestUser
  let tecnico: TestUser
  let profeOtraAula: TestUser
  let tutorVe: TestUser // puede_ver_fotos = true, hijo en `aula`
  let tutorNoVe: TestUser // puede_ver_fotos = false
  let adminB: TestUser

  let ninoVe: { id: string } // hijo de tutorVe, con permiso de aparecer
  let ninoNoVe: { id: string } // hijo de tutorNoVe

  const publicacionesCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Blog')
    centroB = await createTestCentro('Centro Blog B')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Blog')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Blog 2')

    admin = await createTestUser({ nombre: 'Admin Blog' })
    coordinadora = await createTestUser({ nombre: 'Coord Blog' })
    tecnico = await createTestUser({ nombre: 'Tecnico Blog' })
    profeOtraAula = await createTestUser({ nombre: 'Profe Otra' })
    tutorVe = await createTestUser({ nombre: 'Tutor Ve' })
    tutorNoVe = await createTestUser({ nombre: 'Tutor NoVe' })
    adminB = await createTestUser({ nombre: 'Admin B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(tecnico.id, centro.id, 'profe')
    await asignarRol(profeOtraAula.id, centro.id, 'profe')
    await asignarRol(tutorVe.id, centro.id, 'tutor_legal')
    await asignarRol(tutorNoVe.id, centro.id, 'tutor_legal')
    await asignarRol(adminB.id, centroB.id, 'admin')

    await asignarProfeConTipo(coordinadora.id, aula.id, 'coordinadora')
    await asignarProfeConTipo(tecnico.id, aula.id, 'tecnico')
    await asignarProfeConTipo(profeOtraAula.id, aulaB.id, 'coordinadora')

    // Niño de tutorVe: matriculado en `aula`, con permiso de aparecer; vínculo con puede_ver_fotos.
    ninoVe = await createTestNino(centro.id)
    await matricular(ninoVe.id, aula.id, curso.id)
    await setPuedeAparecer(ninoVe.id, true)
    await crearVinculo(ninoVe.id, tutorVe.id, 'tutor_legal_principal', { puede_ver_fotos: true })

    // Niño de tutorNoVe: matriculado en `aula`, vínculo SIN puede_ver_fotos.
    ninoNoVe = await createTestNino(centro.id)
    await matricular(ninoNoVe.id, aula.id, curso.id)
    await setPuedeAparecer(ninoNoVe.id, true)
    await crearVinculo(ninoNoVe.id, tutorNoVe.id, 'tutor_legal_principal', {
      puede_ver_fotos: false,
    })
  })

  afterAll(async () => {
    for (const id of publicacionesCreadas)
      await serviceClient.from('publicaciones').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, coordinadora, tecnico, profeOtraAula, tutorVe, tutorNoVe, adminB])
      await deleteTestUser(u.id)
  })

  async function asignarProfeConTipo(
    profe_id: string,
    aula_id: string,
    tipo: TipoPersonalAula
  ): Promise<void> {
    const { data: ac } = await serviceClient
      .from('aulas_curso')
      .select('curso_academico_id')
      .eq('aula_id', aula_id)
      .limit(1)
      .maybeSingle()
    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id,
      aula_id,
      curso_academico_id: ac!.curso_academico_id,
      fecha_inicio: '2026-09-01',
      tipo_personal_aula: tipo,
    })
    if (error) throw new Error(`asignarProfeConTipo falló: ${error.message}`)
  }

  async function setPuedeAparecer(nino_id: string, valor: boolean): Promise<void> {
    const { error } = await serviceClient
      .from('ninos')
      .update({ puede_aparecer_en_fotos: valor })
      .eq('id', nino_id)
    if (error) throw new Error(`setPuedeAparecer falló: ${error.message}`)
  }

  /** Crea una publicación con service role en `aula` y registra su id para limpieza. */
  async function seedPublicacion(autor: string, aula_id = aula.id): Promise<string> {
    const { data, error } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id, autor_id: autor, texto: 'Día en el cole' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedPublicacion falló: ${error?.message}`)
    publicacionesCreadas.push(data.id)
    return data.id
  }

  async function seedMedia(publicacion_id: string): Promise<string> {
    const payload: MediaInsert = {
      publicacion_id,
      centro_id: centro.id,
      bucket: 'aula-fotos',
      path: `${centro.id}/${aula.id}/${publicacion_id}/${randomUUID()}.jpg`,
      mime: 'image/jpeg',
    }
    const { data, error } = await serviceClient.from('media').insert(payload).select('id').single()
    if (error || !data) throw new Error(`seedMedia falló: ${error?.message}`)
    return data.id
  }

  // --- escritura de publicaciones (P5) ---------------------------------------

  it('coordinadora crea publicación en su aula (.insert().select() — MVCC row-aware)', async () => {
    const c = await clientFor(coordinadora)
    const { data, error } = await c
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: coordinadora.id, texto: 'Hola' })
      .select('id, centro_id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.centro_id).toBe(centro.id) // lo deriva el trigger
    if (data?.id) publicacionesCreadas.push(data.id)
  })

  it('admin crea publicación', async () => {
    const c = await clientFor(admin)
    const { data, error } = await c
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) publicacionesCreadas.push(data.id)
  })

  it('técnico NO puede crear publicación (P5)', async () => {
    const c = await clientFor(tecnico)
    const { data, error } = await c
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: tecnico.id })
      .select('id')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('profe de OTRA aula NO crea en aula ajena', async () => {
    const c = await clientFor(profeOtraAula)
    const { data, error } = await c
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: profeOtraAula.id })
      .select('id')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  // --- visibilidad de familia (P2) -------------------------------------------

  it('familia con puede_ver_fotos ve el blog del aula; sin el permiso NO; otro centro NO', async () => {
    const pub = await seedPublicacion(coordinadora.id)

    const cVe = await clientFor(tutorVe)
    expect((await cVe.from('publicaciones').select('id').eq('id', pub)).data?.length).toBe(1)

    const cNoVe = await clientFor(tutorNoVe)
    expect((await cNoVe.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(0)

    const cAdminB = await clientFor(adminB)
    expect((await cAdminB.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(
      0
    )
  })

  // --- etiquetado (gate P2) ---------------------------------------------------

  it('etiquetar a un niño CON permiso funciona; a uno SIN permiso se bloquea', async () => {
    const pub = await seedPublicacion(coordinadora.id)
    const mediaId = await seedMedia(pub)
    const c = await clientFor(coordinadora)

    const ok = await c
      .from('media_etiquetas')
      .insert({ media_id: mediaId, nino_id: ninoVe.id, centro_id: centro.id })
      .select('id')
      .maybeSingle()
    expect(ok.error).toBeNull()
    expect(ok.data?.id).toBeTruthy()

    // Niño sin permiso de aparecer.
    const ninoBloq = await createTestNino(centro.id)
    await matricular(ninoBloq.id, aula.id, curso.id)
    await setPuedeAparecer(ninoBloq.id, false)
    const ko = await c
      .from('media_etiquetas')
      .insert({ media_id: mediaId, nino_id: ninoBloq.id, centro_id: centro.id })
      .select('id')
      .maybeSingle()
    expect(ko.data).toBeNull()
    expect(ko.error).not.toBeNull()
  })

  it('revocar puede_aparecer OCULTA la publicación a la familia (P2)', async () => {
    const pub = await seedPublicacion(coordinadora.id)
    const mediaId = await seedMedia(pub)
    // Etiqueta a un niño que de momento tiene permiso.
    const ninoTmp = await createTestNino(centro.id)
    await matricular(ninoTmp.id, aula.id, curso.id)
    await setPuedeAparecer(ninoTmp.id, true)
    const { error: etErr } = await serviceClient
      .from('media_etiquetas')
      .insert({ media_id: mediaId, nino_id: ninoTmp.id, centro_id: centro.id })
    expect(etErr).toBeNull()

    const cVe = await clientFor(tutorVe)
    // Visible mientras todos los etiquetados tienen permiso.
    expect((await cVe.from('publicaciones').select('id').eq('id', pub)).data?.length).toBe(1)

    // Revocar → se oculta.
    await setPuedeAparecer(ninoTmp.id, false)
    expect((await cVe.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(0)
  })

  // --- borrado (P-borrado) ---------------------------------------------------

  it('borra la publicación el autor; otro rol no', async () => {
    const pub = await seedPublicacion(coordinadora.id)

    const cTecnico = await clientFor(tecnico)
    await cTecnico.from('publicaciones').delete().eq('id', pub)
    expect(
      (await serviceClient.from('publicaciones').select('id').eq('id', pub)).data?.length
    ).toBe(1) // sigue

    const cAutor = await clientFor(coordinadora)
    await cAutor.from('publicaciones').delete().eq('id', pub)
    expect(
      (await serviceClient.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0
    ).toBe(0)
  })

  // --- Storage (políticas sobre storage.objects) -----------------------------

  it('Storage aula-fotos: sube el redactor del aula; un admin de otro centro NO', async () => {
    const pub = await seedPublicacion(coordinadora.id)
    const path = `${centro.id}/${aula.id}/${pub}/${randomUUID()}.jpg`
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) // jpeg mínimo

    const cCoord = await clientFor(coordinadora)
    const up = await cCoord.storage
      .from('aula-fotos')
      .upload(path, bytes, { contentType: 'image/jpeg' })
    expect(up.error).toBeNull()

    const cAdminB = await clientFor(adminB)
    const pathB = `${centro.id}/${aula.id}/${pub}/${randomUUID()}.jpg`
    const upB = await cAdminB.storage
      .from('aula-fotos')
      .upload(pathB, bytes, { contentType: 'image/jpeg' })
    expect(upB.error).not.toBeNull() // RLS de storage.objects lo bloquea

    await serviceClient.storage.from('aula-fotos').remove([path])
  })
})
