import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  serviceClient,
  type TestUser,
} from './setup'

import { FUENTES_RETENCION } from '@/features/retencion/lib/fuentes-retencion'

/**
 * F11-A6 — esqueleto huérfano (niño-arm). Verifica end-to-end contra la BD remota:
 *   · listar() ve SOLO el huérfano sintético (matrícula 'pendiente' + sin vínculos +
 *     invitación vencida tras gracia), NO los controles (invitación válida / con vínculo).
 *   · limpiarDb() (RPC atómica) borra el huérfano y NO toca los controles.
 *
 * Gateado: F11_A6_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_A6_MIGRATION_APPLIED === '1'

const fuente = FUENTES_RETENCION.find((f) => f.nombre === 'esqueleto-huerfano-nino')

function diasDesdeHoy(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString()
}

async function matriculaPendiente(ninoId: string, aulaId: string, cursoId: string) {
  const { error } = await serviceClient
    .from('matriculas')
    .insert({ nino_id: ninoId, aula_id: aulaId, curso_academico_id: cursoId, estado: 'pendiente' })
  if (error) throw new Error(`matriculaPendiente falló: ${error.message}`)
}

async function invitacion(centroId: string, ninoId: string, expiresAt: string) {
  const { error } = await serviceClient.from('invitaciones').insert({
    email: `a6-inv-${ninoId.slice(0, 8)}@nido.test`,
    rol_objetivo: 'tutor_legal',
    centro_id: centroId,
    nino_id: ninoId,
    tipo_vinculo: 'tutor_legal_principal',
    expires_at: expiresAt,
  })
  if (error) throw new Error(`invitacion falló: ${error.message}`)
}

async function existeNino(ninoId: string): Promise<boolean> {
  const { data } = await serviceClient.from('ninos').select('id').eq('id', ninoId).maybeSingle()
  return data !== null
}

describe.skipIf(!APPLIED)('A6 — esqueleto huérfano niño-arm (RLS/RPC)', () => {
  let centro: { id: string }
  let cursoId: string
  let aulaId: string
  let ninoHuerfano: { id: string } // pendiente + invitación vencida + sin vínculo
  let ninoValido: { id: string } // pendiente + invitación VÁLIDA (no huérfano)
  let ninoConVinculo: { id: string } // pendiente + invitación vencida + CON vínculo (no huérfano)
  let tutor: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro A6 esqueleto')
    const curso = await createTestCurso(centro.id)
    cursoId = curso.id
    const aula = await createTestAula(centro.id, cursoId)
    aulaId = aula.id

    ninoHuerfano = await createTestNino(centro.id, 'Huerfano A6')
    await matriculaPendiente(ninoHuerfano.id, aulaId, cursoId)
    await invitacion(centro.id, ninoHuerfano.id, diasDesdeHoy(-40)) // vencida hace 40d (> gracia 30d)

    ninoValido = await createTestNino(centro.id, 'Valido A6')
    await matriculaPendiente(ninoValido.id, aulaId, cursoId)
    await invitacion(centro.id, ninoValido.id, diasDesdeHoy(5)) // válida (futuro) → NO huérfano

    ninoConVinculo = await createTestNino(centro.id, 'ConVinculo A6')
    await matriculaPendiente(ninoConVinculo.id, aulaId, cursoId)
    await invitacion(centro.id, ninoConVinculo.id, diasDesdeHoy(-40)) // vencida...
    tutor = await createTestUser({ nombre: 'Tutor A6' })
    await crearVinculo(ninoConVinculo.id, tutor.id, 'tutor_legal_principal', {}) // ...pero alguien aceptó → NO huérfano
  })

  afterAll(async () => {
    // Orden FK-safe (ninos→centros es RESTRICT). Best-effort.
    const ids = [ninoValido?.id, ninoConVinculo?.id].filter(Boolean)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', ids)
    await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('matriculas').delete().in('nino_id', ids)
    await serviceClient.from('ninos').delete().in('id', ids)
    await serviceClient.from('aulas').delete().eq('id', aulaId)
    await serviceClient.from('cursos_academicos').delete().eq('id', cursoId)
    await serviceClient.from('centros').delete().eq('id', centro.id)
    if (tutor) await serviceClient.auth.admin.deleteUser(tutor.id)
  })

  it('listar() ve SOLO el huérfano, no los controles', async () => {
    const unidades = await fuente!.listar(serviceClient, new Date().toISOString())
    const ids = unidades.map((u) => u.refId)
    expect(ids).toContain(ninoHuerfano.id)
    expect(ids).not.toContain(ninoValido.id)
    expect(ids).not.toContain(ninoConVinculo.id)

    const unidad = unidades.find((u) => u.refId === ninoHuerfano.id)!
    expect(unidad.categoria).toBe('esqueleto_huerfano')
    expect(unidad.refTipo).toBe('nino')
    expect(unidad.paths).toEqual([])
  })

  it('limpiarDb() borra el huérfano y NO toca los controles', async () => {
    const unidades = await fuente!.listar(serviceClient, new Date().toISOString())
    const unidad = unidades.find((u) => u.refId === ninoHuerfano.id)!

    await fuente!.limpiarDb!(serviceClient, unidad)

    expect(await existeNino(ninoHuerfano.id)).toBe(false) // borrado (CASCADE: matrícula + invitación)
    expect(await existeNino(ninoValido.id)).toBe(true) // intacto
    expect(await existeNino(ninoConVinculo.id)).toBe(true) // intacto
  })

  it('la RPC re-valida: borrar un no-huérfano (con invitación válida) es rechazado', async () => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const { error } = await serviceClient.rpc('purgar_esqueleto_huerfano_nino', {
      p_nino_id: ninoValido.id,
      p_cutoff: cutoff.toISOString(),
    })
    expect(error).not.toBeNull() // check_violation: el predicado no se cumple
    expect(await existeNino(ninoValido.id)).toBe(true)
  })
})
