import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, serviceClient } from './setup'

import { FUENTES_RETENCION } from '@/features/retencion/lib/fuentes-retencion'

/**
 * F11-A6.3 — stub huérfano (stub-arm). Verifica end-to-end contra la BD remota:
 *   · listar() ve el stub huérfano sintético (auth.users sin confirmar + invitación
 *     vencida + sin rol + sin vínculo), NO el control con invitación abierta-válida.
 *   · limpiarDb() re-valida y borra el stub vía Admin API (cascadea public.usuarios).
 *   · TOCTOU: si entre listar y limpiar el stub deja de cumplir (re-invitado), la
 *     re-validación lo rechaza y NO se borra.
 *
 * CRÍTICO: limpia TODOS los stubs sintéticos en afterAll — cero residuo.
 *
 * Gateado: F11_A6_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_A6_MIGRATION_APPLIED === '1'

const fuente = FUENTES_RETENCION.find((f) => f.nombre === 'esqueleto-huerfano-stub')

function diasDesdeHoy(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString()
}

// IDs de todos los usuarios creados, para barrerlos en afterAll (idempotente).
const creados: string[] = []

/** Crea un usuario sin confirmar (stub-like) sin enviar email. */
async function crearStub(confirmado: boolean): Promise<{ id: string; email: string }> {
  const email = `a6-stub-${randomUUID()}@nido.test`
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: confirmado,
    user_metadata: { nombre_completo: 'Stub A6' },
  })
  if (error || !data.user) throw new Error(`crearStub falló: ${error?.message}`)
  creados.push(data.user.id)
  return { id: data.user.id, email }
}

async function invitacionPara(email: string, centroId: string, expiresAt: string) {
  const { error } = await serviceClient.from('invitaciones').insert({
    email,
    rol_objetivo: 'tutor_legal',
    centro_id: centroId,
    expires_at: expiresAt,
  })
  if (error) throw new Error(`invitacionPara falló: ${error.message}`)
}

async function existeUsuario(id: string): Promise<boolean> {
  const { data } = await serviceClient.auth.admin.getUserById(id)
  return Boolean(data?.user)
}

describe.skipIf(!APPLIED)('A6.3 — stub huérfano stub-arm (RPC/Admin API)', () => {
  let centro: { id: string }
  let stubHuerfano: { id: string; email: string } // sin confirmar + invitación vencida → purgable
  let stubValido: { id: string; email: string } // sin confirmar + invitación ABIERTA-VÁLIDA → NO purgable
  let stubConfirmado: { id: string; email: string } // CONFIRMADO + invitación vencida → excluido por guard
  let stubToctou: { id: string; email: string } // purgable al listar; se re-invita antes de limpiar

  beforeAll(async () => {
    centro = await createTestCentro('Centro A6 stub')

    stubHuerfano = await crearStub(false)
    await invitacionPara(stubHuerfano.email, centro.id, diasDesdeHoy(-40)) // vencida > gracia

    stubValido = await crearStub(false)
    await invitacionPara(stubValido.email, centro.id, diasDesdeHoy(5)) // abierta-válida → protege

    stubConfirmado = await crearStub(true)
    await invitacionPara(stubConfirmado.email, centro.id, diasDesdeHoy(-40)) // confirmado → excluido

    stubToctou = await crearStub(false)
    await invitacionPara(stubToctou.email, centro.id, diasDesdeHoy(-40))
  })

  afterAll(async () => {
    for (const id of creados) {
      await serviceClient.auth.admin.deleteUser(id).catch(() => {})
    }
    await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('centros').delete().eq('id', centro.id)
  })

  it('listar() ve el stub huérfano; excluye el válido y el confirmado', async () => {
    const unidades = await fuente!.listar(serviceClient, new Date().toISOString())
    const ids = unidades.map((u) => u.refId)
    expect(ids).toContain(stubHuerfano.id)
    expect(ids).not.toContain(stubValido.id)
    expect(ids).not.toContain(stubConfirmado.id)

    const unidad = unidades.find((u) => u.refId === stubHuerfano.id)!
    expect(unidad.categoria).toBe('esqueleto_huerfano')
    expect(unidad.refTipo).toBe('usuario')
    expect(unidad.centroId).toBe(centro.id)
    expect(unidad.paths).toEqual([])
  })

  it('limpiarDb() re-valida y borra el stub huérfano (cascada a public.usuarios)', async () => {
    const unidades = await fuente!.listar(serviceClient, new Date().toISOString())
    const unidad = unidades.find((u) => u.refId === stubHuerfano.id)!

    await fuente!.limpiarDb!(serviceClient, unidad)

    expect(await existeUsuario(stubHuerfano.id)).toBe(false) // borrado
    expect(await existeUsuario(stubValido.id)).toBe(true) // intacto
    expect(await existeUsuario(stubConfirmado.id)).toBe(true) // intacto
  })

  it('TOCTOU: si el stub se re-invita entre listar y limpiar, NO se borra', async () => {
    const unidades = await fuente!.listar(serviceClient, new Date().toISOString())
    const unidad = unidades.find((u) => u.refId === stubToctou.id)!
    expect(unidad).toBeTruthy() // al listar SÍ era purgable

    // Cambio de estado: una nueva invitación abierta-válida (re-invitación).
    await invitacionPara(stubToctou.email, centro.id, diasDesdeHoy(5))

    // limpiarDb re-valida → ya NO es purgable → lanza y NO borra.
    await expect(fuente!.limpiarDb!(serviceClient, unidad)).rejects.toThrow()
    expect(await existeUsuario(stubToctou.id)).toBe(true)
  })
})
