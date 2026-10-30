import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'
import { cursoDeTest } from './curso-de-test'

/**
 * F11 · Alta tutor-driven · Pieza 1 — Fundación.
 *
 * Verifica a nivel BD los contratos que usa la pieza 1 (migración
 * 20260615150000_phase11_alta_p1_fundacion):
 *   1. CHECK invitaciones_tipo_vinculo_coherente (rol ↔ tipo_vinculo).
 *   2. matricula_estado: default 'activa' + transición a 'baja'.
 *   3. Auto-vínculo idempotente: con un vínculo vivo, `dar_vinculos_de_invitacion` (lo que
 *      llama crearVinculoAutomatico en accept-invitation desde `20261102120000`) no hace nada.
 *
 * El flujo completo de la acción (acceptInvitation/acceptPendingInvitation) usa
 * next/headers (getRequestContext) y auth.admin.createUser → no es invocable en
 * vitest; se verifica en preview. Aquí cubrimos los contratos de datos.
 */

const enUnDia = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

describe('Alta P1 — fundación (DB)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string; curso_academico_id: string }
  const invitacionesCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P1')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
  })

  afterAll(async () => {
    if (invitacionesCreadas.length > 0) {
      await serviceClient.from('invitaciones').delete().in('id', invitacionesCreadas)
    }
    await deleteTestCentro(centro.id)
  })

  // Inserta una invitación cruda y devuelve el error (o null). Registra el id para limpiar.
  async function insertarInvitacion(
    rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado',
    tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado' | null
  ): Promise<string | null> {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .insert({
        email: `p1-${rol}-${tipoVinculo ?? 'null'}-${Math.round(Math.random() * 1e9)}@nido.test`,
        rol_objetivo: rol,
        centro_id: centro.id,
        tipo_vinculo: tipoVinculo,
        expires_at: enUnDia(),
      })
      .select('id')
      .maybeSingle()
    if (data?.id) invitacionesCreadas.push(data.id)
    return error ? error.message : null
  }

  describe('CHECK invitaciones_tipo_vinculo_coherente', () => {
    it('acepta combinaciones coherentes', async () => {
      expect(await insertarInvitacion('admin', null)).toBeNull()
      expect(await insertarInvitacion('profe', null)).toBeNull()
      expect(await insertarInvitacion('tutor_legal', 'tutor_legal_principal')).toBeNull()
      expect(await insertarInvitacion('tutor_legal', 'tutor_legal_secundario')).toBeNull()
      expect(await insertarInvitacion('tutor_legal', null)).toBeNull() // permisivo con NULL
      expect(await insertarInvitacion('autorizado', 'autorizado')).toBeNull()
    })

    it('rechaza admin/profe con tipo_vinculo no-NULL', async () => {
      expect(await insertarInvitacion('admin', 'tutor_legal_principal')).not.toBeNull()
      expect(await insertarInvitacion('profe', 'tutor_legal_principal')).not.toBeNull()
    })

    it('rechaza tutor_legal con "autorizado" y autorizado con tipo de tutor', async () => {
      expect(await insertarInvitacion('tutor_legal', 'autorizado')).not.toBeNull()
      expect(await insertarInvitacion('autorizado', 'tutor_legal_principal')).not.toBeNull()
    })
  })

  describe('matricula_estado', () => {
    it('por defecto es "activa" y admite transición a "baja"', async () => {
      const nino = await createTestNino(centro.id)
      const matriculaId = await matricular(nino.id, aula.id, aula.curso_academico_id)

      const { data: creada } = await serviceClient
        .from('matriculas')
        .select('estado')
        .eq('id', matriculaId)
        .single()
      expect(creada?.estado).toBe('activa')

      const { error: updErr } = await serviceClient
        .from('matriculas')
        .update({ estado: 'baja', fecha_baja: cursoDeTest().fin })
        .eq('id', matriculaId)
      expect(updErr).toBeNull()

      const { data: cerrada } = await serviceClient
        .from('matriculas')
        .select('estado')
        .eq('id', matriculaId)
        .single()
      expect(cerrada?.estado).toBe('baja')

      // Limpieza (matriculas → ON DELETE RESTRICT en nino; borramos matrícula y niño).
      await serviceClient.from('matriculas').delete().eq('id', matriculaId)
      await serviceClient.from('ninos').delete().eq('id', nino.id)
    })
  })

  describe('auto-vínculo idempotente (un vínculo vivo no se toca)', () => {
    let tutor: TestUser
    let nino: { id: string }

    beforeAll(async () => {
      tutor = await createTestUser({ nombre: 'Tutor Alta P1' })
      nino = await createTestNino(centro.id)
    })

    afterAll(async () => {
      await serviceClient.from('vinculos_familiares').delete().eq('nino_id', nino.id)
      await serviceClient.from('ninos').delete().eq('id', nino.id)
      if (tutor) await deleteTestUser(tutor.id)
    })

    it('una segunda aceptación no falla ni duplica ni sobrescribe', async () => {
      // El auto-vínculo va por `dar_vinculos_de_invitacion` (la tabla de motivos de la BD); con
      // un vínculo vivo no hace nada.
      const payloadInicial = {
        p_usuario_id: tutor.id,
        p_nino_ids: [nino.id],
        p_tipo: 'tutor_legal_principal' as const,
        p_parentesco: 'madre' as const,
        p_descripcion_parentesco: null as unknown as string,
        p_permisos: { puede_ver_agenda: true },
      }
      const primero = await serviceClient.rpc('dar_vinculos_de_invitacion', payloadInicial)
      expect(primero.error).toBeNull()

      // Segunda con datos DISTINTOS → no debe tocar la fila.
      const segundo = await serviceClient.rpc('dar_vinculos_de_invitacion', {
        ...payloadInicial,
        p_tipo: 'tutor_legal_secundario',
        p_parentesco: 'padre',
      })
      expect(segundo.error).toBeNull()

      const { data: filas } = await serviceClient
        .from('vinculos_familiares')
        .select('id, tipo_vinculo, parentesco')
        .eq('nino_id', nino.id)
        .eq('usuario_id', tutor.id)
      expect(filas?.length).toBe(1)
      expect(filas?.[0]?.tipo_vinculo).toBe('tutor_legal_principal') // intacto
      expect(filas?.[0]?.parentesco).toBe('madre')
    })
  })
})
