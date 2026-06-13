import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS Fase 11-A (RGPD) — Least-privilege del admin en mensajería.
 *
 * Spec: docs/specs/proteccion-datos.md (Comportamiento 4 + Decisión #11).
 * Migración: 20260613180000_phase11a_mensajeria_least_privilege.
 *
 * Cierra el agujero de la reparación de Mensajería (PR #66): el admin NO puede
 * POSTEAR en conversaciones profe_familia (ni por API), pero CONSERVA el SELECT
 * (supervisión solo-lectura) y sigue escribiendo en admin_familia y en anuncios.
 * Profe y tutor: sin cambios.
 *
 * Gateado por flag (migración aplicada a mano vía SQL Editor — CLI SIGILL):
 *   F11A_LEASTPRIV_MIGRATION_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.F11A_LEASTPRIV_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)(
  'RLS mensajería — F11-A (least-privilege del admin en profe_familia)',
  () => {
    let centroA: { id: string }
    let cursoA: { id: string }
    let aulaA1: { id: string }
    let ninoA1: { id: string }

    let adminA: TestUser
    let profeA1: TestUser
    let tutorA: TestUser

    // Conversaciones de fixtures (creadas con service role para saltar RLS de alta).
    let convProfeFamilia: { id: string }
    let convAdminFamilia: { id: string }

    beforeAll(async () => {
      centroA = await createTestCentro('Centro LP A')
      cursoA = await createTestCurso(centroA.id)
      aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula LP A1')
      ninoA1 = await createTestNino(centroA.id, 'Niño LP A1')
      await matricular(ninoA1.id, aulaA1.id, cursoA.id)

      adminA = await createTestUser({ nombre: 'Admin LP A' })
      await asignarRol(adminA.id, centroA.id, 'admin')

      profeA1 = await createTestUser({ nombre: 'Profe LP A1' })
      await asignarRol(profeA1.id, centroA.id, 'profe')
      await asignarProfeAula(profeA1.id, aulaA1.id)

      tutorA = await createTestUser({ nombre: 'Tutor LP A' })
      await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
      await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })

      // profe_familia (1 por niño)
      const { data: cpf } = await serviceClient
        .from('conversaciones')
        .insert({ nino_id: ninoA1.id, centro_id: centroA.id })
        .select('id')
        .single()
      convProfeFamilia = cpf!

      // admin_familia (par admin↔tutor, con expires_at futuro)
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data: caf } = await serviceClient
        .from('conversaciones')
        .insert({
          centro_id: centroA.id,
          tipo_conversacion: 'admin_familia',
          admin_id: adminA.id,
          tutor_id: tutorA.id,
          expires_at: future,
        })
        .select('id')
        .single()
      convAdminFamilia = caf!

      // Un mensaje previo (profe) para los tests de SELECT de supervisión.
      await serviceClient.from('mensajes').insert({
        conversacion_id: convProfeFamilia.id,
        autor_id: profeA1.id,
        contenido: 'mensaje-previo-profe',
      })
    }, 180_000)

    afterAll(async () => {
      const usuarios = [adminA?.id, profeA1?.id, tutorA?.id].filter((u): u is string => Boolean(u))
      await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
      await serviceClient.from('anuncios').delete().in('autor_id', usuarios)
      await serviceClient.from('conversaciones').delete().eq('nino_id', ninoA1.id)
      await serviceClient.from('conversaciones').delete().eq('admin_id', adminA.id)
      await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
      await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
      await serviceClient.from('matriculas').delete().eq('nino_id', ninoA1.id)
      await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
      for (const u of usuarios) await deleteTestUser(u)
    }, 120_000)

    // -------------------------------------------------------------------
    // El cambio: admin NO postea en profe_familia
    // -------------------------------------------------------------------

    it('lp01 — admin NO puede INSERT en mensajes de profe_familia (RLS lo rechaza)', async () => {
      const client = await clientFor(adminA)
      const { data, error } = await client
        .from('mensajes')
        .insert({
          conversacion_id: convProfeFamilia.id,
          autor_id: adminA.id,
          contenido: 'lp01-admin-no-deberia-poder',
        })
        .select('id')
        .single()
      expect(error).toBeTruthy()
      expect(error?.code).toBe('42501')
      expect(data).toBeNull()
    })

    // -------------------------------------------------------------------
    // Lo que se conserva: SELECT del admin (supervisión)
    // -------------------------------------------------------------------

    it('lp02 — admin CONSERVA el SELECT de la conversación profe_familia', async () => {
      const client = await clientFor(adminA)
      const { data, error } = await client
        .from('conversaciones')
        .select('id')
        .eq('id', convProfeFamilia.id)
      expect(error).toBeNull()
      expect((data ?? []).map((c) => c.id)).toContain(convProfeFamilia.id)
    })

    it('lp03 — admin CONSERVA el SELECT de los mensajes profe_familia (lectura de supervisión)', async () => {
      const client = await clientFor(adminA)
      const { data, error } = await client
        .from('mensajes')
        .select('id, contenido')
        .eq('conversacion_id', convProfeFamilia.id)
      expect(error).toBeNull()
      expect((data ?? []).some((m) => m.contenido === 'mensaje-previo-profe')).toBe(true)
    })

    // -------------------------------------------------------------------
    // Escritura legítima del admin: NO se rompe
    // -------------------------------------------------------------------

    it('lp04 — admin SÍ puede INSERT en mensajes de admin_familia (su hilo)', async () => {
      const client = await clientFor(adminA)
      const { data, error } = await client
        .from('mensajes')
        .insert({
          conversacion_id: convAdminFamilia.id,
          autor_id: adminA.id,
          contenido: 'lp04-admin-escribe-admin-familia',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) await serviceClient.from('mensajes').delete().eq('id', data.id)
    })

    it('lp05 — admin SÍ puede INSERT anuncio ámbito=centro', async () => {
      const client = await clientFor(adminA)
      const { data, error } = await client
        .from('anuncios')
        .insert({
          autor_id: adminA.id,
          centro_id: centroA.id,
          ambito: 'centro',
          aula_id: null,
          titulo: 'lp05-aviso-centro',
          contenido: 'lp05-contenido',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) await serviceClient.from('anuncios').delete().eq('id', data.id)
    })

    // -------------------------------------------------------------------
    // Profe y tutor: sin cambios (regresión)
    // -------------------------------------------------------------------

    it('lp06 — profe del aula SIGUE pudiendo INSERT en profe_familia', async () => {
      const client = await clientFor(profeA1)
      const { data, error } = await client
        .from('mensajes')
        .insert({
          conversacion_id: convProfeFamilia.id,
          autor_id: profeA1.id,
          contenido: 'lp06-profe-sigue-escribiendo',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) await serviceClient.from('mensajes').delete().eq('id', data.id)
    })

    it('lp07 — tutor con puede_recibir_mensajes SIGUE pudiendo INSERT en profe_familia', async () => {
      const client = await clientFor(tutorA)
      const { data, error } = await client
        .from('mensajes')
        .insert({
          conversacion_id: convProfeFamilia.id,
          autor_id: tutorA.id,
          contenido: 'lp07-tutor-sigue-escribiendo',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) await serviceClient.from('mensajes').delete().eq('id', data.id)
    })
  }
)
