import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
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
 * F-3-E — visibilidad de un niño ARCHIVADO (baja: `ninos.deleted_at` set + sus
 * `vinculos_familiares.deleted_at` set). Respalda la variante `getNinoById(id,
 * { incluirArchivado: true })` de la ficha de Dirección: leer el niño SIN el filtro
 * de `deleted_at` a nivel de query.
 *
 *  - Admin del centro: PUEDE leer el archivado (RLS `ninos_admin_all` = es_admin, no
 *    filtra deleted_at). La "puerta" del archivo es segura porque la RLS ya la gatea.
 *  - Tutor con acceso vigente: NO puede leer el archivado ni quitando el filtro de la
 *    query, porque su vínculo quedó soft-borrado y `es_tutor_de` lo exige vivo.
 *
 * No requiere migración (comprueba RLS ya existente) → corre en la suite normal.
 */

const NOW = '2026-07-12T00:00:00.000Z'

describe('F-3-E — visibilidad de niño archivado', () => {
  let centro: { id: string }
  let admin: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>
  let ninoId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro F3E')
    admin = await createTestUser({ nombre: 'Admin F3E' })
    tutor = await createTestUser({ nombre: 'Tutor F3E' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    cAdmin = await clientFor(admin)
    cTutor = await clientFor(tutor)

    const familiaId = await createTestFamilia(centro.id)
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre: 'Niño F3E',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    ninoId = nino!.id
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal')
  }, 60_000)

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutor.id)
  }, 60_000)

  it('activo: admin y tutor ven al niño (sanity previo)', async () => {
    const a = await cAdmin.from('ninos').select('id').eq('id', ninoId).maybeSingle()
    const t = await cTutor.from('ninos').select('id').eq('id', ninoId).maybeSingle()
    expect(a.data?.id).toBe(ninoId)
    expect(t.data?.id).toBe(ninoId)
  })

  it('archivado: admin SÍ lee (sin filtro), tutor NO (vínculo muerto)', async () => {
    // Archivar: soft-delete del niño + de sus vínculos (equivalente a archivar_nino).
    await serviceClient.from('ninos').update({ deleted_at: NOW }).eq('id', ninoId)
    await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_at: NOW })
      .eq('nino_id', ninoId)

    // Admin, query SIN filtro de deleted_at (= incluirArchivado): lo lee.
    const adminRaw = await cAdmin
      .from('ninos')
      .select('id, deleted_at')
      .eq('id', ninoId)
      .maybeSingle()
    expect(adminRaw.data?.id).toBe(ninoId)
    expect(adminRaw.data?.deleted_at).not.toBeNull()

    // Admin, query CON filtro (= comportamiento por defecto de getNinoById): oculto.
    const adminFiltrado = await cAdmin
      .from('ninos')
      .select('id')
      .eq('id', ninoId)
      .is('deleted_at', null)
      .maybeSingle()
    expect(adminFiltrado.data).toBeNull()

    // Tutor, incluso SIN filtro: la RLS (es_tutor_de con vínculo vivo) lo deniega.
    const tutorRaw = await cTutor.from('ninos').select('id').eq('id', ninoId).maybeSingle()
    expect(tutorRaw.data).toBeNull()
  })
})
