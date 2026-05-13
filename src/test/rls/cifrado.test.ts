import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

describe('Cifrado pgcrypto en info_medica_emergencia — roundtrip via funciones BD', () => {
  let centro: { id: string }
  let nino: { id: string }
  let admin: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cifrado')
    nino = await createTestNino(centro.id, 'Niño Cifrado')
    admin = await createTestUser({ nombre: 'Admin Cifrado' })
    await asignarRol(admin.id, centro.id, 'admin')
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('info_medica_emergencia').delete().eq('nino_id', nino.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', admin.id)
    await deleteTestUser(admin.id)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('set_info_medica_emergencia_cifrada (admin) + get_info_medica_emergencia roundtrip', async () => {
    const client = await clientFor(admin)
    const alergiasOriginal = 'Alergia grave a frutos secos y huevo'
    const notasOriginal = 'Adrenalina en mochila, contactar al 112 inmediatamente'

    const { data: setData, error: setError } = await client.rpc(
      'set_info_medica_emergencia_cifrada',
      {
        p_nino_id: nino.id,
        p_alergias_graves: alergiasOriginal,
        p_notas_emergencia: notasOriginal,
        p_medicacion_habitual: 'Ventolín si sibilancias',
        p_alergias_leves: 'polen',
        p_medico_familia: 'Dra. Pruebas',
        p_telefono_emergencia: '+34 600 000 000',
      }
    )
    expect(setError).toBeNull()
    expect(setData).toBeTruthy()

    const { data: getData, error: getError } = await client.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
    })
    expect(getError).toBeNull()
    expect(getData?.[0]?.alergias_graves).toBe(alergiasOriginal)
    expect(getData?.[0]?.notas_emergencia).toBe(notasOriginal)
    expect(getData?.[0]?.medicacion_habitual).toBe('Ventolín si sibilancias')
  })

  it('SELECT directo a la columna alergias_graves devuelve BYTEA (no plaintext)', async () => {
    const { data, error } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves')
      .eq('nino_id', nino.id)
      .single()
    expect(error).toBeNull()
    expect(data?.alergias_graves).toBeTruthy()
    // PostgREST serializa BYTEA como string hex con prefijo \x.
    // No debe contener el texto plano.
    const raw = String(data?.alergias_graves)
    expect(raw).not.toContain('frutos secos')
    expect(raw).not.toContain('Alergia grave')
    expect(raw.startsWith('\\x')).toBe(true)
  })

  it('NULL en parámetros del setter preserva los valores existentes (UPDATE selectivo)', async () => {
    const client = await clientFor(admin)

    // Estado inicial poblado en el primer test. Llamamos al setter con todos
    // los parámetros como NULL salvo medicacion_habitual: debería actualizar
    // SOLO medicacion_habitual y preservar el resto. El tipo generado por
    // Supabase declara los args como string no nullable, pero la función SQL
    // acepta NULL como sentinela "no tocar este campo" — cast a unknown.
    const rpcArgs = {
      p_nino_id: nino.id,
      p_alergias_graves: null,
      p_notas_emergencia: null,
      p_medicacion_habitual: 'Cambiada a ibuprofeno suspensión',
      p_alergias_leves: null,
      p_medico_familia: null,
      p_telefono_emergencia: null,
    } as unknown as {
      p_nino_id: string
      p_alergias_graves: string
      p_notas_emergencia: string
      p_medicacion_habitual: string
      p_alergias_leves: string
      p_medico_familia: string
      p_telefono_emergencia: string
    }
    const { error: setError } = await client.rpc('set_info_medica_emergencia_cifrada', rpcArgs)
    expect(setError).toBeNull()

    const { data, error } = await client.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
    })
    expect(error).toBeNull()
    expect(data?.[0]?.medicacion_habitual).toBe('Cambiada a ibuprofeno suspensión')
    // Las alergias_graves deben seguir intactas (NULL = preservar).
    expect(data?.[0]?.alergias_graves).toBe('Alergia grave a frutos secos y huevo')
    expect(data?.[0]?.alergias_leves).toBe('polen')
  })
})
