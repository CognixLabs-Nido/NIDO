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
 * RLS de la vista de FAMILIA del blog (F10-2, P-histórico). Verifica la vía nueva
 * "mi hijo aparece etiquetado" de `usuario_ve_publicacion_row` (migración
 * `20260612120000_phase10_2_fotos_familia_historico`):
 *  - **Histórico:** la familia conserva una publicación pasada donde su hijo está
 *    etiquetado AUNQUE el niño ya no tenga matrícula activa en el aula; y deja de ver
 *    las publicaciones nuevas del aula que no le etiquetan.
 *  - **Permiso:** sin `puede_ver_fotos` no ve nada (ni por la vía histórica).
 *  - **Revocado:** revocar `puede_aparecer_en_fotos` oculta la publicación histórica.
 *  - **Aislamiento:** una familia de otra aula/centro no la ve.
 *
 * **Gated** por `F10_2_MIGRATION_APPLIED=1` (la migración se aplica a mano por SQL
 * Editor — CLI SIGILL). Comando:
 *   F10_2_MIGRATION_APPLIED=1 npm run test:rls -- publicaciones-familia.rls
 */
const MIGRATION_APPLIED = process.env.F10_2_MIGRATION_APPLIED === '1'

type MediaInsert = Database['public']['Tables']['media']['Insert']

describe.skipIf(!MIGRATION_APPLIED)('RLS blog del aula — F10-2 (familia · histórico)', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }

  let coordinadora: TestUser
  let tutorHist: TestUser // hijo etiquetado pero SIN matrícula activa (se fue)
  let tutorNoVe: TestUser // hijo etiquetado pero sin puede_ver_fotos
  let tutorAjeno: TestUser // hijo en otra aula, no etiquetado

  let ninoHist: { id: string }
  let ninoNoVe: { id: string }

  const publicacionesCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Blog Fam')
    centroB = await createTestCentro('Centro Blog Fam B')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Fam')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Fam 2')

    coordinadora = await createTestUser({ nombre: 'Coord Fam' })
    tutorHist = await createTestUser({ nombre: 'Tutor Hist' })
    tutorNoVe = await createTestUser({ nombre: 'Tutor NoVe Fam' })
    tutorAjeno = await createTestUser({ nombre: 'Tutor Ajeno' })

    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(tutorHist.id, centro.id, 'tutor_legal')
    await asignarRol(tutorNoVe.id, centro.id, 'tutor_legal')
    await asignarRol(tutorAjeno.id, centro.id, 'tutor_legal')
    await asignarProfeConTipo(coordinadora.id, aula.id, 'coordinadora')

    // ninoHist: matriculado en `aula`, luego se da de BAJA (cambió/se fue). Mantiene
    // permiso de aparecer + vínculo con puede_ver_fotos. Queda sin matrícula activa.
    ninoHist = await createTestNino(centro.id)
    const matriculaHist = await matricular(ninoHist.id, aula.id, curso.id)
    await setPuedeAparecer(ninoHist.id, true)
    await crearVinculo(ninoHist.id, tutorHist.id, 'tutor_legal_principal', {
      puede_ver_fotos: true,
    })
    await darDeBaja(matriculaHist)

    // ninoNoVe: matriculado en `aula`, permiso de aparecer, pero el vínculo NO ve fotos.
    ninoNoVe = await createTestNino(centro.id)
    await matricular(ninoNoVe.id, aula.id, curso.id)
    await setPuedeAparecer(ninoNoVe.id, true)
    await crearVinculo(ninoNoVe.id, tutorNoVe.id, 'tutor_legal_principal', {
      puede_ver_fotos: false,
    })

    // tutorAjeno: su hijo está en `aulaB` (activo), con permiso de ver — no etiquetado aquí.
    const ninoAjeno = await createTestNino(centro.id)
    await matricular(ninoAjeno.id, aulaB.id, curso.id)
    await crearVinculo(ninoAjeno.id, tutorAjeno.id, 'tutor_legal_principal', {
      puede_ver_fotos: true,
    })
  })

  afterAll(async () => {
    for (const id of publicacionesCreadas)
      await serviceClient.from('publicaciones').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [coordinadora, tutorHist, tutorNoVe, tutorAjeno]) await deleteTestUser(u.id)
  })

  async function asignarProfeConTipo(
    profe_id: string,
    aula_id: string,
    tipo: Database['public']['Enums']['tipo_personal_aula']
  ): Promise<void> {
    const { error } = await serviceClient
      .from('profes_aulas')
      .insert({ profe_id, aula_id, fecha_inicio: '2026-09-01', tipo_personal_aula: tipo })
    if (error) throw new Error(`asignarProfeConTipo falló: ${error.message}`)
  }

  async function setPuedeAparecer(nino_id: string, valor: boolean): Promise<void> {
    const { error } = await serviceClient
      .from('ninos')
      .update({ puede_aparecer_en_fotos: valor })
      .eq('id', nino_id)
    if (error) throw new Error(`setPuedeAparecer falló: ${error.message}`)
  }

  async function darDeBaja(matriculaId: string): Promise<void> {
    const { error } = await serviceClient
      .from('matriculas')
      .update({ fecha_baja: '2027-01-01' })
      .eq('id', matriculaId)
    if (error) throw new Error(`darDeBaja falló: ${error.message}`)
  }

  /** Publicación en `aula` con service role; registra su id para limpieza. */
  async function seedPublicacion(aula_id = aula.id): Promise<string> {
    const { data, error } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id, autor_id: coordinadora.id, texto: 'Día en el cole' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedPublicacion falló: ${error?.message}`)
    publicacionesCreadas.push(data.id)
    return data.id
  }

  /** Crea una media en la publicación y la etiqueta con `nino_id` (todo service role). */
  async function seedMediaEtiquetada(publicacion_id: string, nino_id: string): Promise<void> {
    const payload: MediaInsert = {
      publicacion_id,
      centro_id: centro.id,
      bucket: 'aula-fotos',
      path: `${centro.id}/${aula.id}/${publicacion_id}/${randomUUID()}.jpg`,
      mime: 'image/jpeg',
    }
    const { data: media, error } = await serviceClient
      .from('media')
      .insert(payload)
      .select('id')
      .single()
    if (error || !media) throw new Error(`seedMedia falló: ${error?.message}`)
    const { error: etErr } = await serviceClient
      .from('media_etiquetas')
      .insert({ media_id: media.id, nino_id, centro_id: centro.id })
    if (etErr) throw new Error(`etiquetar falló: ${etErr.message}`)
  }

  it('histórico: la familia ve una publicación donde su hijo está etiquetado aunque NO tenga matrícula activa', async () => {
    const pub = await seedPublicacion()
    await seedMediaEtiquetada(pub, ninoHist.id)

    const cHist = await clientFor(tutorHist)
    expect((await cHist.from('publicaciones').select('id').eq('id', pub)).data?.length).toBe(1)

    // Las fotos (media) de esa publicación también son visibles (heredan la RLS).
    const mediaVisible = await cHist.from('media').select('id').eq('publicacion_id', pub)
    expect((mediaVisible.data?.length ?? 0) > 0).toBe(true)
  })

  it('histórico: deja de ver las publicaciones NUEVAS del aula que no etiquetan a su hijo', async () => {
    const pubNueva = await seedPublicacion() // sin etiquetar a ninoHist
    const cHist = await clientFor(tutorHist)
    expect(
      (await cHist.from('publicaciones').select('id').eq('id', pubNueva)).data?.length ?? 0
    ).toBe(0)
  })

  it('sin puede_ver_fotos NO ve la publicación aunque su hijo esté etiquetado', async () => {
    const pub = await seedPublicacion()
    await seedMediaEtiquetada(pub, ninoNoVe.id)
    const cNoVe = await clientFor(tutorNoVe)
    expect((await cNoVe.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(0)
  })

  it('revocar puede_aparecer oculta la publicación histórica', async () => {
    const pub = await seedPublicacion()
    await seedMediaEtiquetada(pub, ninoHist.id)
    const cHist = await clientFor(tutorHist)
    expect((await cHist.from('publicaciones').select('id').eq('id', pub)).data?.length).toBe(1)

    await setPuedeAparecer(ninoHist.id, false)
    expect((await cHist.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(0)
    await setPuedeAparecer(ninoHist.id, true) // restaura para otros tests
  })

  it('aislamiento: una familia de otra aula no ve la publicación', async () => {
    const pub = await seedPublicacion()
    await seedMediaEtiquetada(pub, ninoHist.id)
    const cAjeno = await clientFor(tutorAjeno)
    expect((await cAjeno.from('publicaciones').select('id').eq('id', pub)).data?.length ?? 0).toBe(
      0
    )
  })
})
