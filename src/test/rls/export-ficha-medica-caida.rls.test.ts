import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clienteConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

import { recolectarNino } from '@/features/export/lib/recolectar'

/**
 * MEDIDO ABIERTO (censo C, grupo 1, decisión de Jose del 2026-11-27): «el export del art. 15». La ficha médica
 * del niño se lee con `get_info_medica_emergencia`; cualquier error que no sea el del bloqueo se convierte en
 * «Existe información médica; no accesible con tu rol/permiso actual»: un motivo falso para quien SÍ tiene el
 * permiso, en la copia de sus datos. Contra la base efímera; lo único simulado: la RPC contesta error.
 * Fixtures ficticios del 2026-11-27.
 */
const NO_ACCESIBLE = 'no accesible con tu rol'

describe('el export no dice «no accesible con tu rol» cuando la ficha médica no se pudo leer (medido abierto)', () => {
  let centro: { id: string }
  let nino: TestNino
  let tutor: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro Export Ficha')
    nino = await createTestNino(centro.id)
    tutor = await createTestUser({ nombre: 'Tutor Export Ficha' })
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    // Con el permiso de la ficha médica: sin él la base la niega y la nota «no accesible» es VERDAD (lo midió
    // la primera corrida, run 45967108427: el control salía rojo con un vínculo sin permisos).
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
  }, 90_000)

  afterAll(async () => {
    await deleteTestUser(tutor.id)
    await deleteTestCentro(centro.id)
  }, 90_000)

  it('control: sin el fallo, la copia no dice «no accesible» (el tutor legal tiene el permiso)', async () => {
    const r = await recolectarNino(await clientFor(tutor), serviceClient, nino.id)
    expect(r, 'premisa: el tutor legal exporta a su hijo').not.toBeNull()
    expect(JSON.stringify(r?.data ?? null)).not.toContain(NO_ACCESIBLE)
  })

  it('con la lectura de la ficha caída: lo que dice la copia', async () => {
    const s = {
      actual: await clientFor(tutor),
      fallaTabla: null,
      fallaRpc: 'get_info_medica_emergencia',
      fallidas: 0,
    }
    let lanzo: string | null = null
    let info: unknown = null
    try {
      const r = await recolectarNino(clienteConFallos(s), serviceClient, nino.id)
      info = r?.data ?? null
    } catch (e) {
      lanzo = e instanceof Error ? e.message : String(e)
    }
    expect(s.fallidas, 'premisa: la RPC de la ficha falló').toBeGreaterThan(0)
    expect.soft(JSON.stringify(info), 'la copia da un motivo falso').not.toContain(NO_ACCESIBLE)
    console.warn(
      'export con la ficha caída:',
      JSON.stringify({ lanzo, dicenoAccesible: JSON.stringify(info).includes(NO_ACCESIBLE) })
    )
  })
})
