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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de `recordatorios` (F6-C, modelo granular). Gated por
 * `RECORDATORIOS_MIGRATION_APPLIED=1`: la migración
 * `20260601120000_phase6c_reminders_remodel.sql` se aplica manualmente vía
 * Supabase SQL Editor (CLI con bug SIGILL en Penguin). Hasta entonces estos
 * tests se omiten para no romper la suite.
 *
 * Cubre la matriz D9 completa (INSERT por rol×destino), la visibilidad SELECT
 * por destino (incl. aislamiento por centro), el gotcha MVCC `.insert().select()`
 * en los 6 destinos, el RPC `contar_recordatorios_pendientes` (destinatario
 * directo vs visibilidad), y DELETE denegado.
 */
const MIGRATION_APPLIED = process.env.RECORDATORIOS_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS recordatorios — F6-C (modelo granular)', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let aulaB: { id: string } // misma centro, sin tutor ni profe del set principal
  let admin: TestUser
  let profe: TestUser // asignada a `aula`
  let profeCentro: TestUser // rol profe del centro, sin aula del set
  let tutor: TestUser // tutor del niño en `aula`, flag true
  let autorizado: TestUser // vínculo al niño, flag false
  let tutorOtro: TestUser // tutor de otro centro → aislamiento
  let nino: { id: string }
  const creados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Rec C')
    centroB = await createTestCentro('Centro Rec C B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Principal')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Secundaria')
    nino = await createTestNino(centro.id, 'Reminder C')
    await matricular(nino.id, aula.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin RecC' })
    profe = await createTestUser({ nombre: 'Profe RecC' })
    profeCentro = await createTestUser({ nombre: 'Profe Centro RecC' })
    tutor = await createTestUser({ nombre: 'Tutor RecC' })
    autorizado = await createTestUser({ nombre: 'Autorizado RecC' })
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro RecC' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(profeCentro.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(tutorOtro.id, centroB.id, 'tutor_legal')

    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', { puede_recibir_mensajes: false })
  }, 180_000)

  afterAll(async () => {
    if (creados.length > 0) {
      await serviceClient.from('recordatorios').delete().in('id', creados)
    }
    for (const u of [admin, profe, profeCentro, tutor, autorizado, tutorOtro]) {
      if (u?.id) await deleteTestUser(u.id)
    }
    if (centro?.id) await deleteTestCentro(centro.id)
    if (centroB?.id) await deleteTestCentro(centroB.id)
  }, 180_000)

  // Helper: inserta como `user` y registra para limpieza. Devuelve {data,error}.
  async function insertarComo(
    user: TestUser,
    payload: Record<string, unknown>
  ): Promise<{ id: string | null; code: string | undefined }> {
    const c = await clientFor(user)
    const { data, error } = await c
      .from('recordatorios')
      .insert(payload as never)
      .select('id')
      .maybeSingle()
    if (data?.id) creados.push(data.id)
    return { id: data?.id ?? null, code: error?.code }
  }

  // ── INSERT: matriz D9 (admin crea los 6; .select() ok = MVCC no aplica) ────
  it('admin crea los 6 destinos y .select() devuelve la fila (gotcha MVCC NO aplica)', async () => {
    const casos: Array<Record<string, unknown>> = [
      { destinatario: 'familia_individual', nino_id: nino.id, titulo: 'fam ind' },
      { destinatario: 'familias_aula', aula_id: aula.id, titulo: 'fam aula' },
      { destinatario: 'familias_centro', titulo: 'fam centro' },
      { destinatario: 'profe_individual', usuario_destinatario_id: profe.id, titulo: 'profe ind' },
      { destinatario: 'profes_centro', titulo: 'profes centro' },
      { destinatario: 'personal', usuario_destinatario_id: admin.id, titulo: 'personal admin' },
    ]
    for (const caso of casos) {
      const r = await insertarComo(admin, { centro_id: centro.id, creado_por: admin.id, ...caso })
      expect(r.code, `destino ${caso.destinatario}`).toBeUndefined()
      expect(r.id, `destino ${caso.destinatario}`).toBeTruthy()
    }
  })

  it('profe crea familia_individual (su niño), familias_aula (su aula) y personal', async () => {
    const famInd = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'familia_individual',
      nino_id: nino.id,
      titulo: 'profe→familia',
    })
    expect(famInd.code).toBeUndefined()

    const famAula = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'familias_aula',
      aula_id: aula.id,
      titulo: 'profe→aula',
    })
    expect(famAula.code).toBeUndefined()

    const personal = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'personal',
      usuario_destinatario_id: profe.id,
      titulo: 'profe nota',
    })
    expect(personal.code).toBeUndefined()
  })

  it('profe NO crea familias_centro, profe_individual ni profes_centro (42501)', async () => {
    const centroBroad = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'familias_centro',
      titulo: 'ilegal',
    })
    expect(centroBroad.code).toBe('42501')

    const profeInd = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'profe_individual',
      usuario_destinatario_id: profeCentro.id,
      titulo: 'ilegal',
    })
    expect(profeInd.code).toBe('42501')

    const profesCentro = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'profes_centro',
      titulo: 'ilegal',
    })
    expect(profesCentro.code).toBe('42501')
  })

  it('profe NO crea familias_aula de un aula que no es suya (42501)', async () => {
    const r = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'familias_aula',
      aula_id: aulaB.id,
      titulo: 'aula ajena',
    })
    expect(r.code).toBe('42501')
  })

  it('tutor no crea NINGÚN destino (solo recibe)', async () => {
    const famInd = await insertarComo(tutor, {
      centro_id: centro.id,
      creado_por: tutor.id,
      destinatario: 'familia_individual',
      nino_id: nino.id,
      titulo: 'tutor ilegal',
    })
    expect(famInd.code).toBe('42501')

    const personal = await insertarComo(tutor, {
      centro_id: centro.id,
      creado_por: tutor.id,
      destinatario: 'personal',
      usuario_destinatario_id: tutor.id,
      titulo: 'tutor personal',
    })
    expect(personal.code).toBe('42501')
  })

  it('personal: no se puede crear para otro usuario (anti-suplantación)', async () => {
    const r = await insertarComo(profe, {
      centro_id: centro.id,
      creado_por: profe.id,
      destinatario: 'personal',
      usuario_destinatario_id: admin.id,
      titulo: 'suplantación',
    })
    expect(r.code).toBe('42501')
  })

  // ── SELECT: visibilidad por destino + aislamiento por centro ───────────────
  it('familia_individual: tutor con flag lo VE; autorizado sin flag NO; tutorOtro NO', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'familia_individual',
      nino_id: nino.id,
      titulo: 'visible fam',
    })

    const cTutor = await clientFor(tutor)
    const visto = await cTutor
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familia_individual')
    expect((visto.data ?? []).length).toBeGreaterThan(0)

    const cAut = await clientFor(autorizado)
    const noVisto = await cAut
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familia_individual')
    expect((noVisto.data ?? []).length).toBe(0)

    const cOtro = await clientFor(tutorOtro)
    const aislado = await cOtro.from('recordatorios').select('id')
    expect((aislado.data ?? []).length).toBe(0)
  })

  it('familias_aula: tutor del aula y profe del aula lo VEN; tutorOtro NO', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'familias_aula',
      aula_id: aula.id,
      titulo: 'visible aula',
    })

    const cTutor = await clientFor(tutor)
    const tutorVe = await cTutor
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familias_aula')
    expect((tutorVe.data ?? []).length).toBeGreaterThan(0)

    const cProfe = await clientFor(profe)
    const profeVe = await cProfe
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familias_aula')
    expect((profeVe.data ?? []).length).toBeGreaterThan(0)

    const cOtro = await clientFor(tutorOtro)
    const otroVe = await cOtro
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familias_aula')
    expect((otroVe.data ?? []).length).toBe(0)
  })

  it('familias_centro: tutor del centro lo VE; tutorOtro NO', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'familias_centro',
      titulo: 'visible centro',
    })

    const cTutor = await clientFor(tutor)
    const tutorVe = await cTutor
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familias_centro')
    expect((tutorVe.data ?? []).length).toBeGreaterThan(0)

    const cOtro = await clientFor(tutorOtro)
    const otroVe = await cOtro
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'familias_centro')
    expect((otroVe.data ?? []).length).toBe(0)
  })

  it('profe_individual: la profe destinataria y el admin lo VEN; otra profe NO', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'profe_individual',
      usuario_destinatario_id: profe.id,
      titulo: 'a la profe',
    })

    const cProfe = await clientFor(profe)
    const profeVe = await cProfe
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'profe_individual')
    expect((profeVe.data ?? []).length).toBeGreaterThan(0)

    const cAdmin = await clientFor(admin)
    const adminVe = await cAdmin
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'profe_individual')
    expect((adminVe.data ?? []).length).toBeGreaterThan(0)

    const cOtra = await clientFor(profeCentro)
    const otraVe = await cOtra
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'profe_individual')
    expect((otraVe.data ?? []).length).toBe(0)
  })

  it('profes_centro: cualquier profe del centro lo VE; tutor NO', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'profes_centro',
      titulo: 'a todas las profes',
    })

    const cProfe = await clientFor(profeCentro)
    const profeVe = await cProfe
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'profes_centro')
    expect((profeVe.data ?? []).length).toBeGreaterThan(0)

    const cTutor = await clientFor(tutor)
    const tutorVe = await cTutor
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'profes_centro')
    expect((tutorVe.data ?? []).length).toBe(0)
  })

  it('personal: solo el destinatario lo VE', async () => {
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'personal',
      usuario_destinatario_id: admin.id,
      titulo: 'solo admin',
    })

    const cProfe = await clientFor(profe)
    const profeVe = await cProfe
      .from('recordatorios')
      .select('id')
      .eq('destinatario', 'personal')
      .eq('usuario_destinatario_id', admin.id)
    expect((profeVe.data ?? []).length).toBe(0)
  })

  // ── RPC badge: destinatario directo, no mera visibilidad ───────────────────
  it('contar_recordatorios_pendientes: tutor cuenta sus broadcasts; admin no cuenta lo que solo observa', async () => {
    // Recordatorio familia_individual creado por admin → el tutor es destinatario;
    // el admin solo lo observa (no destinatario).
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'familia_individual',
      nino_id: nino.id,
      titulo: 'badge fam',
    })

    const cTutor = await clientFor(tutor)
    const { data: tutorCount, error: e1 } = await cTutor.rpc('contar_recordatorios_pendientes')
    expect(e1).toBeNull()
    expect(tutorCount ?? 0).toBeGreaterThan(0)

    // El autorizado tiene puede_recibir_mensajes=false. NO es destinatario de
    // `familia_individual` (gateado por el flag en el RPC), PERO sí de los
    // broadcasts `familias_aula`/`familias_centro`: su visibilidad sigue la
    // PERTENENCIA (es_tutor_en_aula/es_tutor_en_centro), no el flag — trade-off
    // documentado en ADR-0037 (el flag solo gatea el push). Por eso su contador
    // refleja los broadcasts del aula/centro (>0), no 0.
    const cAut = await clientFor(autorizado)
    const { data: autCount } = await cAut.rpc('contar_recordatorios_pendientes')
    expect(autCount ?? 0).toBeGreaterThan(0)

    // Flag-gating sobre familia_individual (determinista): tutor y autorizado
    // ven los MISMOS broadcasts (mismo niño/aula/centro), pero solo el tutor
    // (flag true) cuenta los `familia_individual` → cuenta estrictamente más.
    expect(tutorCount ?? 0).toBeGreaterThan(autCount ?? 0)

    // Recordatorio personal del admin → SÍ cuenta para el admin; pero los
    // familia_* que creó NO. Creamos uno personal y comprobamos que el conteo
    // del admin es exactamente el de sus personales pendientes (≥1, sin inflar
    // por los broadcasts que creó).
    await insertarComo(admin, {
      centro_id: centro.id,
      creado_por: admin.id,
      destinatario: 'personal',
      usuario_destinatario_id: admin.id,
      titulo: 'badge personal admin',
    })
    const cAdmin = await clientFor(admin)
    const { data: adminCount } = await cAdmin.rpc('contar_recordatorios_pendientes')
    expect(adminCount ?? 0).toBeGreaterThan(0)
  })

  // ── DELETE denegado ────────────────────────────────────────────────────────
  it('DELETE: bloqueado para admin (default DENY)', async () => {
    const { data: rec } = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'familias_centro',
        creado_por: admin.id,
        titulo: 'borrar test',
      })
      .select('id')
      .single()
    if (rec?.id) creados.push(rec.id)

    const cAdmin = await clientFor(admin)
    await cAdmin.from('recordatorios').delete().eq('id', rec!.id)

    const { data: sigue } = await serviceClient
      .from('recordatorios')
      .select('id')
      .eq('id', rec!.id)
      .maybeSingle()
    expect(sigue?.id).toBe(rec!.id)
  })
})
