import type { SupabaseClient } from '@supabase/supabase-js'
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

const MEDICACION = 'Paracetamol gotas'

/** La fila tal cual está en la tabla (bytea como `\\x…`), leída con service role. */
async function filaCruda(ninoId: string) {
  const { data } = await serviceClient
    .from('info_medica_emergencia')
    .select('id, medicacion_habitual, alergias_leves')
    .eq('nino_id', ninoId)
    .maybeSingle()
  return data as {
    id: string
    medicacion_habitual: string | null
    alergias_leves: string | null
  } | null
}

describe('RLS info_medica_emergencia — permiso puede_ver_info_medica controla acceso', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let admin: TestUser
  let clientAdmin: SupabaseClient<Database>
  let tutorConPermiso: TestUser
  let tutorSinPermiso: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro InfoMedica RLS')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Niño Médico')
    await matricular(nino.id, aula.id, curso.id)

    // La ficha se crea como en la app: Dirección, por el setter que cifra (20261123120000).
    admin = await createTestUser({ nombre: 'Admin InfoMedica' })
    await asignarRol(admin.id, centro.id, 'admin')
    clientAdmin = await clientFor(admin)
    await serviceClient.from('info_medica_emergencia').insert({
      nino_id: nino.id,
      medicacion_habitual: MEDICACION,
      alergias_leves: 'polen',
    })

    tutorConPermiso = await createTestUser({ nombre: 'Tutor con acceso' })
    await asignarRol(tutorConPermiso.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutorConPermiso.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })

    tutorSinPermiso = await createTestUser({ nombre: 'Tutor sin acceso' })
    await asignarRol(tutorSinPermiso.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutorSinPermiso.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: false,
    })
  }, 60_000)

  afterAll(async () => {
    await serviceClient
      .from('vinculos_familiares')
      .delete()
      .in('usuario_id', [tutorConPermiso.id, tutorSinPermiso.id])
    await serviceClient
      .from('roles_usuario')
      .delete()
      .in('usuario_id', [admin.id, tutorConPermiso.id, tutorSinPermiso.id])
    await deleteTestUser(admin.id)
    await deleteTestUser(tutorConPermiso.id)
    await deleteTestUser(tutorSinPermiso.id)
    await serviceClient.from('info_medica_emergencia').delete().eq('nino_id', nino.id)
    await serviceClient.from('matriculas').delete().eq('nino_id', nino.id)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('tutor con permiso puede_ver_info_medica lee la fila', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data, error } = await client
      .from('info_medica_emergencia')
      .select('medicacion_habitual')
      .eq('nino_id', nino.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('tutor sin permiso puede_ver_info_medica no lee la fila', async () => {
    const client = await clientFor(tutorSinPermiso)
    const { data, error } = await client
      .from('info_medica_emergencia')
      .select('medicacion_habitual')
      .eq('nino_id', nino.id)
    expect(error).toBeNull()
    // RLS filtra silenciosamente: array vacío, no error.
    expect((data ?? []).length).toBe(0)
  })

  it('la ficha de partida tiene la forma real: cifrada, sin el texto', async () => {
    const fila = await filaCruda(nino.id)
    expect(fila?.medicacion_habitual?.startsWith('\\x')).toBe(true)
    expect(fila?.medicacion_habitual).not.toContain(Buffer.from(MEDICACION, 'utf8').toString('hex'))
    expect(fila?.alergias_leves?.startsWith('\\x')).toBe(true)
    // PostgREST devuelve también como `\\x…` un texto en claro guardado en bytea: lo que
    // distingue el cifrado es que no lleva dentro los bytes del texto.
    expect(fila?.alergias_leves).not.toContain(Buffer.from('polen', 'utf8').toString('hex'))
  })
})

/**
 * Dirección no escribe la tabla directamente (20261124120000): solo por los setters, que cifran.
 * Antes `ime_admin_all` era FOR ALL y una escritura directa podía guardar texto en claro en las
 * columnas bytea. Ahora la policy es de SELECT y `authenticated` no tiene INSERT/UPDATE/DELETE.
 */
describe('RLS info_medica_emergencia — Dirección solo lee la tabla', () => {
  let centro: { id: string }
  let nino: { id: string }
  let ninoSinFicha: { id: string }
  let admin: TestUser
  let clientAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro InfoMedica Solo Lectura')
    nino = await createTestNino(centro.id, 'Niño Demo Solo Lectura')
    ninoSinFicha = await createTestNino(centro.id, 'Niño Demo Sin Ficha')
    admin = await createTestUser({ nombre: 'Admin Solo Lectura' })
    await asignarRol(admin.id, centro.id, 'admin')
    clientAdmin = await clientFor(admin)
    const { error } = await clientAdmin.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: nino.id,
      p_medicacion_habitual: MEDICACION,
      p_alergias_graves: null,
      p_notas_emergencia: null,
      p_alergias_leves: null,
      p_medico_familia: null,
      p_telefono_emergencia: null,
    } as unknown as Database['public']['Functions']['set_info_medica_emergencia_cifrada']['Args'])
    if (error) throw new Error(`set_info_medica_emergencia_cifrada: ${error.message}`)
  }, 60_000)

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('control positivo: Dirección lee la ficha de su centro con la sesión', async () => {
    const { data, error } = await clientAdmin
      .from('info_medica_emergencia')
      .select('id, medicacion_habitual')
      .eq('nino_id', nino.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.medicacion_habitual).not.toBeNull()
  })

  it('UPDATE directo: 42501 y la ficha no cambia', async () => {
    const antes = await filaCruda(nino.id)
    expect(antes?.medicacion_habitual).not.toBeNull()

    const { error } = await clientAdmin
      .from('info_medica_emergencia')
      .update({ medicacion_habitual: 'texto en claro' })
      .eq('nino_id', nino.id)
    expect(error?.code).toBe('42501')
    expect(await filaCruda(nino.id)).toEqual(antes)
  })

  it('INSERT directo: 42501 y no se crea ficha', async () => {
    const { error } = await clientAdmin
      .from('info_medica_emergencia')
      .insert({ nino_id: ninoSinFicha.id, medicacion_habitual: 'texto en claro' })
    expect(error?.code).toBe('42501')
    expect(await filaCruda(ninoSinFicha.id)).toBeNull()
  })

  it('DELETE directo: 42501 y la ficha sigue', async () => {
    const { error } = await clientAdmin
      .from('info_medica_emergencia')
      .delete()
      .eq('nino_id', nino.id)
    expect(error?.code).toBe('42501')
    expect(await filaCruda(nino.id)).not.toBeNull()
  })

  it('los setters siguen escribiendo: Dirección cambia la ficha por su función', async () => {
    const antes = await filaCruda(nino.id)
    const { error } = await clientAdmin.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: nino.id,
      p_medicacion_habitual: 'Ibuprofeno ficticio',
      p_alergias_graves: null,
      p_notas_emergencia: null,
      p_alergias_leves: null,
      p_medico_familia: null,
      p_telefono_emergencia: null,
    } as unknown as Database['public']['Functions']['set_info_medica_emergencia_cifrada']['Args'])
    expect(error).toBeNull()
    const despues = await filaCruda(nino.id)
    expect(despues?.medicacion_habitual?.startsWith('\\x')).toBe(true)
    expect(despues?.medicacion_habitual).not.toBe(antes?.medicacion_habitual)
  })
})
