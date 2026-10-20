import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Multicentro · Fase 2 — un adulto con familia en DOS centros.
 *
 * Hasta la Fase 2 este caso no podía existir (`ux_familia_tutores_usuario_unico`), así que no
 * había ningún test de él: estos son la única prueba de que funciona. Un tutor tiene una
 * familia en A, con un hijo matriculado, y otra en B, creada por el alta real
 * (`crear_o_anadir_a_familia`) con el hermano a medio alta.
 *
 *  - BD: el índice nuevo (una familia por adulto Y centro), el centro de `familia_tutores`
 *    derivado de la familia, y el centro de una familia que no cambia.
 *  - App: cada consulta de `/family` con la sesión del tutor ve lo de un centro. Cada caso
 *    empieza por su premisa: sin acotar, la RLS le deja ver lo de los dos centros (es suyo), y
 *    así el filtro tiene algo que quitar.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { ambitoFamiliar, familiaDelUsuarioEn, esDelAmbito } =
  await import('@/features/centros/contexto/ambito-familiar')
const { estadoAltaFamilia, destinoGateFamilia } = await import('@/features/alta/lib/gate-familia')
const { getRecibosFamilia } = await import('@/features/recibos/queries/get-recibos-familia')
const { getReciboFamiliaDetalle } =
  await import('@/features/recibos/queries/get-recibo-familia-detalle')
const { getReciboParaPdf } = await import('@/features/recibos/queries/get-recibo-pdf-data')
const { getCitasRango } = await import('@/features/agenda/queries/get-citas-rango')
const { getInformesPublicadosFamilia } =
  await import('@/features/informes/queries/get-informes-familia')
const { getPublicacionesFamilia } =
  await import('@/features/fotos/queries/get-publicaciones-familia')
const { getMedicacionContextoFamilia } =
  await import('@/features/autorizaciones/queries/get-medicacion-familia')
const { getAvisosInicio } = await import('@/features/notificaciones/queries/get-avisos-inicio')

const HOY_PASADO = '2024-03-15'

describe('Multicentro · Fase 2 — un adulto con familia en dos centros', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA: { id: string }
  let aulaB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let tutor: TestUser
  let cTutor: SupabaseClient<Database>
  let familiaA: string
  let familiaB: string
  let ninoA: string // matrícula activa en A
  let ninoB: string // a medio alta en B (matrícula pendiente)
  let reciboA: string
  let reciboB: string

  async function nuevoRecibo(centroId: string, familiaId: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        anio: 2026,
        mes: 10,
        estado: 'pendiente_procesar',
        total_centimos: 1000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  async function nuevaCita(centroId: string, organizador: string, titulo: string) {
    const { data, error } = await serviceClient
      .from('citas')
      .insert({
        centro_id: centroId,
        organizador_id: organizador,
        tipo: 'visita',
        titulo,
        fecha: '2026-11-10',
        hora_inicio: '10:00',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`cita: ${error?.message}`)
    const inv = await serviceClient
      .from('cita_invitados')
      .insert({ cita_id: data.id, centro_id: centroId, usuario_id: tutor.id })
    if (inv.error) throw new Error(`invitado: ${inv.error.message}`)
    return data.id
  }

  async function nuevoInforme(
    centroId: string,
    cursoId: string,
    ninoId: string,
    autor: string
  ): Promise<string> {
    const { data: plantilla, error: pErr } = await serviceClient
      .from('plantillas_informe')
      .insert({ centro_id: centroId, creado_por: autor, titulo: 'Plantilla F2' })
      .select('id')
      .single()
    if (pErr || !plantilla) throw new Error(`plantilla informe: ${pErr?.message}`)
    const { data, error } = await serviceClient
      .from('informes_evolucion')
      .insert({
        centro_id: centroId,
        curso_academico_id: cursoId,
        nino_id: ninoId,
        plantilla_id: plantilla.id,
        creado_por: autor,
        periodo: 'trimestre_1',
        estructura_snapshot: [],
        estado: 'publicado',
        publicado_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`informe: ${error?.message}`)
    return data.id
  }

  async function nuevaPublicacion(centroId: string, aulaId: string, autor: string) {
    const { data, error } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centroId, aula_id: aulaId, autor_id: autor, texto: 'Día F2' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`publicación: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Familia Por Centro A')
    centroB = await createTestCentro('Centro Familia Por Centro B')
    cursoA = await createTestCurso(centroA.id, 'activo')
    cursoB = await createTestCurso(centroB.id, 'activo')
    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula F2 A')
    aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula F2 B')
    adminA = await createTestUser({ nombre: 'Admin F2 A' })
    adminB = await createTestUser({ nombre: 'Admin F2 B' })
    tutor = await createTestUser({ nombre: 'Tutor Dos Centros' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')

    // Centro A: familia con el tutor de titular y un hijo con matrícula activa.
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    familiaA = await createTestFamilia(centroA.id)
    await crearFamiliaTutor(familiaA, tutor.id, 'titular')
    const { data: nA, error: nAErr } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroA.id,
        familia_id: familiaA,
        nombre: 'Hijo En A',
        apellidos: 'Dos Centros',
        fecha_nacimiento: HOY_PASADO,
      })
      .select('id')
      .single()
    if (nAErr || !nA) throw new Error(`niño A: ${nAErr?.message}`)
    ninoA = nA.id
    await serviceClient.from('matriculas').insert({
      nino_id: ninoA,
      aula_id: aulaA.id,
      curso_academico_id: cursoA.id,
      fecha_alta: '2026-09-01',
    })
    await crearVinculo(ninoA, tutor.id, 'tutor_legal_principal', { puede_ver_fotos: true })

    // Centro B: el alta real de un hermano. Antes de la Fase 2 este INSERT de
    // familia_tutores chocaba con el índice único global (23505). Desde el PR 1 de la Fase 4,
    // la directora de B no puede vincular sin más a un tutor de A: lo invita (la RPC crea su
    // perfil sin cuenta) y él acepta, que es lo que enlaza el perfil, el rol y el vínculo.
    const cAdminB = await clientFor(adminB)
    const { data: alta, error: altaErr } = await cAdminB.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Hermano En B',
      p_apellidos_nino: 'Dos Centros',
      p_fecha_nacimiento: HOY_PASADO,
      p_centro_id: centroB.id,
      p_aula_id: aulaB.id,
      p_tutor_email: tutor.email,
      p_tutor_nombre_completo: '',
      p_parentesco: '',
      p_descripcion_parentesco: '',
      p_usuario_id: null as unknown as string,
      p_permisos: {},
    })
    if (altaErr) throw new Error(`alta en B: ${altaErr.message}`)
    const res = alta as { resultado: string; familia_id: string; nino_id: string }
    if (res.resultado !== 'familia_creada') throw new Error(`alta en B: ${res.resultado}`)
    familiaB = res.familia_id
    ninoB = res.nino_id
    // Lo que deja su aceptación (`acceptPendingInvitationCore`).
    const { error: enlaceErr } = await serviceClient
      .from('familia_tutores')
      .update({ usuario_id: tutor.id, nombre_completo: 'Tutor Dos Centros' })
      .eq('familia_id', familiaB)
      .is('usuario_id', null)
    if (enlaceErr) throw new Error(`aceptar en B: ${enlaceErr.message}`)
    await asignarRol(tutor.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB, tutor.id, 'tutor_legal_principal')

    reciboA = await nuevoRecibo(centroA.id, familiaA)
    reciboB = await nuevoRecibo(centroB.id, familiaB)

    cTutor = await clientFor(tutor)
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    // recibos.familia_id es RESTRICT: fuera antes de que deleteTestCentro borre las familias.
    if (reciboA || reciboB) {
      await serviceClient.from('recibos').delete().in('id', [reciboA, reciboB].filter(Boolean))
    }
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
    for (const u of [adminA, adminB, tutor]) if (u) await deleteTestUser(u.id)
  }, 120_000)

  // ── BD ────────────────────────────────────────────────────────────────────────────────

  it('premisa: el tutor tiene una familia viva en cada centro, con el centro de su familia', async () => {
    const { data, error } = await serviceClient
      .from('familia_tutores')
      .select('familia_id, centro_id')
      .eq('usuario_id', tutor.id)
      .is('deleted_at', null)
    expect(error).toBeNull()
    expect((data ?? []).map((f) => `${f.familia_id}:${f.centro_id}`).sort()).toEqual(
      [`${familiaA}:${centroA.id}`, `${familiaB}:${centroB.id}`].sort()
    )
  })

  it('índice: una segunda familia viva del mismo adulto en el MISMO centro → 23505', async () => {
    const otraEnA = await createTestFamilia(centroA.id)
    const { error } = await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: otraEnA, usuario_id: tutor.id, rol_familia: 'titular' })
    expect(error?.code).toBe('23505')
    expect(error?.message).toContain('ux_familia_tutores_usuario_centro')
  })

  it('trigger: un centro_id que no es el de la familia → 23514; sin él, lo pone', async () => {
    const otra = await createTestFamilia(centroA.id)
    const mal = await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: otra, rol_familia: 'titular', centro_id: centroB.id })
    expect(mal.error?.code).toBe('23514')

    const bien = await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: otra, rol_familia: 'titular' })
      .select('centro_id')
      .single()
    expect(bien.error).toBeNull()
    expect(bien.data?.centro_id).toBe(centroA.id)
  })

  it('trigger: si la fila cambia de familia (service role), el centro se recalcula', async () => {
    const origen = await createTestFamilia(centroA.id)
    const destino = await createTestFamilia(centroB.id)
    const { data: fila } = await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: origen, rol_familia: 'titular' })
      .select('id, centro_id')
      .single()
    expect(fila?.centro_id).toBe(centroA.id)

    const { data: movida, error } = await serviceClient
      .from('familia_tutores')
      .update({ familia_id: destino })
      .eq('id', fila!.id)
      .select('centro_id')
      .single()
    expect(error).toBeNull()
    expect(movida?.centro_id).toBe(centroB.id)
  })

  it('el centro de una familia no se cambia → 23514', async () => {
    const { error } = await serviceClient
      .from('familias')
      .update({ centro_id: centroB.id })
      .eq('id', familiaA)
    expect(error?.code).toBe('23514')
  })

  // ── App: el ámbito de cada centro ─────────────────────────────────────────────────────

  it('ámbito: los hijos del tutor en cada centro, y ninguno del otro', async () => {
    sesion.actual = cTutor
    const { data: todos } = await cTutor
      .from('vinculos_familiares')
      .select('nino_id')
      .eq('usuario_id', tutor.id)
      .is('deleted_at', null)
    expect((todos ?? []).map((v) => v.nino_id).sort()).toEqual([ninoA, ninoB].sort())

    expect((await ambitoFamiliar(centroA.id)).hijos.map((h) => h.id)).toEqual([ninoA])
    expect((await ambitoFamiliar(centroB.id)).hijos.map((h) => h.id)).toEqual([ninoB])
    const a = await ambitoFamiliar(centroA.id)
    expect(esDelAmbito(a, centroA.id)).toBe(true)
    expect(esDelAmbito(a, centroB.id)).toBe(false)
  })

  it('domiciliación: la familia del tutor es la de cada centro', async () => {
    sesion.actual = cTutor
    expect(await familiaDelUsuarioEn(centroA.id)).toEqual({
      familiaId: familiaA,
      centroId: centroA.id,
    })
    expect(await familiaDelUsuarioEn(centroB.id)).toEqual({
      familiaId: familiaB,
      centroId: centroB.id,
    })
  })

  it('gate: el hijo activo en A no desbloquea B, donde el hermano está a medio alta', async () => {
    sesion.actual = cTutor
    const enA = await estadoAltaFamilia(centroA.id)
    expect(enA).toEqual({ ninosEnAlta: [], hayNinoActivo: true })
    expect(destinoGateFamilia(enA)).toBeNull()

    const enB = await estadoAltaFamilia(centroB.id)
    expect(enB).toEqual({ ninosEnAlta: [ninoB], hayNinoActivo: false })
    expect(destinoGateFamilia(enB)).toBe(ninoB)
  })

  it('recibos: la lista, el detalle y el PDF solo con los del centro', async () => {
    sesion.actual = cTutor
    const { data: todos } = await cTutor.from('recibos').select('id').is('deleted_at', null)
    expect((todos ?? []).map((r) => r.id).sort()).toEqual([reciboA, reciboB].sort())

    const ambA = await ambitoFamiliar(centroA.id)
    const ambB = await ambitoFamiliar(centroB.id)
    expect((await getRecibosFamilia(ambA)).map((r) => r.id)).toEqual([reciboA])
    expect((await getRecibosFamilia(ambB)).map((r) => r.id)).toEqual([reciboB])

    expect(await getReciboFamiliaDetalle(ambA, reciboB)).toBeNull()
    expect((await getReciboFamiliaDetalle(ambB, reciboB))?.id).toBe(reciboB)
    expect(await getReciboParaPdf(ambA, reciboB)).toBeNull()
    expect(await getReciboParaPdf(ambB, reciboB)).not.toBeNull()
  })

  it('citas (widget de la semana y agenda): solo las del centro', async () => {
    const citaA = await nuevaCita(centroA.id, adminA.id, 'Cita En A')
    const citaB = await nuevaCita(centroB.id, adminB.id, 'Cita En B')
    sesion.actual = cTutor
    const { data: todas } = await cTutor.from('citas').select('id')
    expect((todas ?? []).map((c) => c.id).sort()).toEqual([citaA, citaB].sort())

    expect((await getCitasRango(centroA.id, '2026-11-01', '2026-11-30')).map((c) => c.id)).toEqual([
      citaA,
    ])
    expect((await getCitasRango(centroB.id, '2026-11-01', '2026-11-30')).map((c) => c.id)).toEqual([
      citaB,
    ])
  })

  it('informes y avisos del inicio: solo los del centro', async () => {
    const informeA = await nuevoInforme(centroA.id, cursoA.id, ninoA, adminA.id)
    const informeB = await nuevoInforme(centroB.id, cursoB.id, ninoB, adminB.id)
    sesion.actual = cTutor
    const { data: todos } = await cTutor
      .from('informes_evolucion')
      .select('id')
      .eq('estado', 'publicado')
    expect((todos ?? []).map((i) => i.id).sort()).toEqual([informeA, informeB].sort())

    const enA = await getInformesPublicadosFamilia(await ambitoFamiliar(centroA.id))
    expect(enA.map((n) => n.ninoId)).toEqual([ninoA])
    const enB = await getInformesPublicadosFamilia(await ambitoFamiliar(centroB.id))
    expect(enB.map((n) => n.ninoId)).toEqual([ninoB])

    const avisosA = await getAvisosInicio('tutor_legal', centroA.id)
    expect(avisosA.informesNuevos).toBe(1)
    expect(avisosA.recibosNuevos).toBe(1)
  })

  it('medicación: la plantilla y los hijos del centro', async () => {
    const { error } = await serviceClient.from('autorizaciones').insert({
      centro_id: centroB.id,
      tipo: 'medicacion',
      es_plantilla: true,
      titulo: 'Formato medicación B',
      texto: 'Texto de prueba del formato, definitivo para el test.',
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: adminB.id,
    })
    if (error) throw new Error(`plantilla: ${error.message}`)
    sesion.actual = cTutor
    const { data: plantillas } = await cTutor
      .from('autorizaciones')
      .select('id')
      .eq('tipo', 'medicacion')
      .eq('es_plantilla', true)
    expect(plantillas ?? []).toHaveLength(1)

    const enA = await getMedicacionContextoFamilia(await ambitoFamiliar(centroA.id))
    expect(enA.plantillaDisponible).toBe(false)
    expect(enA.ninos.map((n) => n.id)).toEqual([ninoA])
    const enB = await getMedicacionContextoFamilia(await ambitoFamiliar(centroB.id))
    expect(enB.plantillaDisponible).toBe(true)
    expect(enB.ninos.map((n) => n.id)).toEqual([ninoB])
  })

  it('fotos: con un hijo activo en cada centro, el blog de cada uno en su centro', async () => {
    // El hermano de B termina el alta (para que la RLS le deje ver el blog de su aula).
    await serviceClient.from('matriculas').update({ estado: 'activa' }).eq('nino_id', ninoB)
    await serviceClient
      .from('vinculos_familiares')
      .update({ permisos: { puede_ver_fotos: true } })
      .eq('nino_id', ninoB)
      .eq('usuario_id', tutor.id)
    const pubA = await nuevaPublicacion(centroA.id, aulaA.id, adminA.id)
    const pubB = await nuevaPublicacion(centroB.id, aulaB.id, adminB.id)
    sesion.actual = cTutor
    const { data: todas } = await cTutor.from('publicaciones').select('id')
    expect((todas ?? []).map((p) => p.id).sort()).toEqual([pubA, pubB].sort())

    expect(
      (await getPublicacionesFamilia(await ambitoFamiliar(centroA.id))).map((p) => p.id)
    ).toEqual([pubA])
    expect(
      (await getPublicacionesFamilia(await ambitoFamiliar(centroB.id))).map((p) => p.id)
    ).toEqual([pubB])
  })
})
