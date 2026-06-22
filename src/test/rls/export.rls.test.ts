import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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

import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'
import { registrarExport } from '@/features/export/lib/registrar'

/**
 * RLS Fase 11-A5 (RGPD) — Export de datos (acceso art. 15 + portabilidad art. 20).
 *
 * Spec: docs/specs/proteccion-datos.md (Decisión #10). Migración:
 * 20260615120000_phase11a5_export_log (tabla export_log + RLS admin-SELECT).
 *
 * Verifica que los colectores devuelven lo del sujeto respetando la RLS del
 * solicitante (aislamiento entre familias), el descifrado médico gateado por
 * permiso (#3), fotos exclusivas vs compartidas (#2), mensajes completos (#6), y
 * la RLS de export_log (#7).
 *
 * Gateado por flag (migración a mano vía SQL Editor — CLI SIGILL):
 *   F11A5_EXPORT_MIGRATION_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.F11A5_EXPORT_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS export de datos — F11-A5', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let centroOtro: { id: string }
  let admin: TestUser
  let adminOtro: TestUser
  let tutor: TestUser // principal, con permiso médico/fotos/mensajes
  let tutorSec: TestUser // secundario, SIN permiso médico
  let tutorB: TestUser // otra familia
  let nino: { id: string }
  let ninoB: { id: string }

  const usuarios: string[] = []
  const ninos: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Export')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Export')
    centroOtro = await createTestCentro('Centro Export Ajeno')

    admin = await createTestUser({ nombre: 'Admin Export' })
    usuarios.push(admin.id)
    await asignarRol(admin.id, centro.id, 'admin')
    adminOtro = await createTestUser({ nombre: 'Admin Ajeno' })
    usuarios.push(adminOtro.id)
    await asignarRol(adminOtro.id, centroOtro.id, 'admin')

    nino = await createTestNino(centro.id, 'Nino Export')
    ninoB = await createTestNino(centro.id, 'Nino Export B')
    ninos.push(nino.id, ninoB.id)
    await matricular(nino.id, aula.id, curso.id)
    await matricular(ninoB.id, aula.id, curso.id)
    await serviceClient
      .from('ninos')
      .update({ puede_aparecer_en_fotos: true })
      .in('id', [nino.id, ninoB.id])

    tutor = await createTestUser({ nombre: 'Tutor Export' })
    usuarios.push(tutor.id)
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
      puede_recibir_mensajes: true,
      puede_ver_fotos: true,
    })

    tutorSec = await createTestUser({ nombre: 'Tutor Export Sec' })
    usuarios.push(tutorSec.id)
    await asignarRol(tutorSec.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutorSec.id, 'tutor_legal_secundario', {})

    tutorB = await createTestUser({ nombre: 'Tutor Export B' })
    usuarios.push(tutorB.id)
    await asignarRol(tutorB.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {})

    // Info médica (cifrado vía RPC admin).
    const ca = await clientFor(admin)
    await ca.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: nino.id,
      p_alergias_graves: 'cacahuete',
      p_notas_emergencia: 'epipen',
      p_medicacion_habitual: 'ninguna',
      p_alergias_leves: 'polen',
      p_medico_familia: 'Dra. García',
      p_telefono_emergencia: '600111222',
    })

    // Consentimiento del tutor (para su export).
    await serviceClient.from('consentimientos').insert({
      usuario_id: tutor.id,
      tipo: 'privacidad',
      version: 'v1.0',
    })
  }, 240_000)

  afterAll(async () => {
    await serviceClient
      .from('export_log')
      .delete()
      .in('sujeto_id', [...usuarios, ...ninos])
    await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
    await serviceClient.from('conversaciones').delete().in('nino_id', ninos)
    await serviceClient.from('media_etiquetas').delete().in('nino_id', ninos)
    await serviceClient.from('publicaciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
    await serviceClient.from('info_medica_emergencia').delete().in('nino_id', ninos)
    await serviceClient.from('matriculas').delete().in('nino_id', ninos)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', ninos)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    await serviceClient.from('ninos').delete().in('id', ninos)
    for (const u of usuarios) await deleteTestUser(u)
    await serviceClient.from('centros').delete().in('id', [centro.id, centroOtro.id])
  }, 120_000)

  // e01 — la familia recolecta su propio usuario
  it('e01 — recolectarUsuario devuelve la ficha + consentimientos + vínculos del sujeto', async () => {
    const c = await clientFor(tutor)
    const rec = await recolectarUsuario(c, tutor.id)
    expect(rec).not.toBeNull()
    expect((rec!.data.ficha as { id: string }).id).toBe(tutor.id)
    expect((rec!.data.consentimientos as unknown[]).length).toBeGreaterThan(0)
    expect((rec!.data.vinculos_familiares as unknown[]).length).toBeGreaterThan(0)
    expect(rec!.centroId).toBe(centro.id)
  })

  // e02 — la familia recolecta a su hijo
  it('e02 — recolectarNino devuelve la ficha del niño accesible', async () => {
    const c = await clientFor(tutor)
    const rec = await recolectarNino(c, serviceClient, nino.id)
    expect(rec).not.toBeNull()
    expect((rec!.data.ficha as { id: string }).id).toBe(nino.id)
    expect(rec!.centroId).toBe(centro.id)
  })

  // e03 — info médica: descifrada con permiso; nota sin permiso (#3)
  it('e03 — info médica descifrada con puede_ver_info_medica; nota de existencia sin permiso', async () => {
    const conPermiso = await recolectarNino(await clientFor(tutor), serviceClient, nino.id)
    const med = conPermiso!.data.info_medica_emergencia as Record<string, unknown>
    expect(med.medico_familia).toBe('Dra. García')

    const sinPermiso = await recolectarNino(await clientFor(tutorSec), serviceClient, nino.id)
    const medSec = sinPermiso!.data.info_medica_emergencia as Record<string, unknown>
    expect(medSec._nota).toBeDefined()
    expect(medSec.medico_familia).toBeUndefined()
  })

  // e04 — aislamiento: una familia no exporta al niño de otra
  it('e04 — un tutor de otra familia NO puede recolectar a este niño (RLS → null)', async () => {
    const c = await clientFor(tutorB)
    const rec = await recolectarNino(c, serviceClient, nino.id)
    expect(rec).toBeNull()
  })

  // e05 — export_log: admin del centro lo ve; admin de otro centro no (#7)
  it('e05 — export_log: SELECT solo para admin del centro', async () => {
    await registrarExport(
      serviceClient,
      [{ sujeto_tipo: 'usuario', sujeto_id: tutor.id, centro_id: centro.id }],
      tutor.id
    )
    const cAdmin = await clientFor(admin)
    const { data: visto } = await cAdmin.from('export_log').select('id').eq('sujeto_id', tutor.id)
    expect((visto ?? []).length).toBeGreaterThan(0)

    const cOtro = await clientFor(adminOtro)
    const { data: noVisto } = await cOtro.from('export_log').select('id').eq('sujeto_id', tutor.id)
    expect(noVisto ?? []).toHaveLength(0)
  })

  // e06 — fotos: exclusiva con binario; compartida solo metadata (#2)
  it('e06 — foto exclusiva → adjunto; foto compartida → metadata sin binario', async () => {
    const { data: pub } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id, texto: 'post export' })
      .select('id')
      .single()
    const mk = async (path: string) => {
      const { data } = await serviceClient
        .from('media')
        .insert({
          publicacion_id: pub!.id,
          centro_id: centro.id,
          bucket: 'aula-fotos',
          path,
          mime: 'image/jpeg',
        })
        .select('id')
        .single()
      return data!.id
    }
    const excl = await mk(`${centro.id}/${aula.id}/${pub!.id}/excl.jpg`)
    const comp = await mk(`${centro.id}/${aula.id}/${pub!.id}/comp.jpg`)
    await serviceClient.from('media_etiquetas').insert([
      { media_id: excl, nino_id: nino.id, centro_id: centro.id },
      { media_id: comp, nino_id: nino.id, centro_id: centro.id },
      { media_id: comp, nino_id: ninoB.id, centro_id: centro.id },
    ])

    const rec = await recolectarNino(await clientFor(tutor), serviceClient, nino.id)
    const adjuntos = rec!.data.adjuntos as Array<{ path: string }>
    const compartidas = rec!.data.fotos_compartidas as Array<{ aparece_junto_a_otros: number }>
    expect(adjuntos.some((a) => a.path.endsWith('excl.jpg'))).toBe(true)
    expect(adjuntos.some((a) => a.path.endsWith('comp.jpg'))).toBe(false)
    expect(compartidas.length).toBe(1)
    expect(compartidas[0]?.aparece_junto_a_otros).toBe(1)
  })

  // e07 — mensajes: el hilo donde el tutor participa se incluye completo (#6)
  it('e07 — recolectarUsuario incluye los mensajes del hilo del sujeto', async () => {
    const { data: conv } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: nino.id, centro_id: centro.id })
      .select('id')
      .single()
    await serviceClient
      .from('mensajes')
      .insert({ conversacion_id: conv!.id, autor_id: tutor.id, contenido: 'Hola, soy la familia' })

    const rec = await recolectarUsuario(await clientFor(tutor), tutor.id)
    const mensajes = rec!.data.mensajes as Array<{ contenido: string }>
    expect(mensajes.some((m) => m.contenido === 'Hola, soy la familia')).toBe(true)
  })
})
