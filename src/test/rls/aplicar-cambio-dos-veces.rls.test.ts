import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

import { aplicarCambioPendiente, type CambioRow } from '@/features/cambios-pendientes/lib/aplicar'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_SIP_NINOS,
} from '@/shared/lib/adjuntos/storage'

/**
 * MEDIDA ANTES DE CONSTRUIR (censo C, B2, condición de Jose del 2026-11-27): «mide la idempotencia ANTES de
 * construir». El diseño aprobado deja el cambio en la cola hasta que se aplicó; el caso inverso —aplicado y sin
 * marcar— hace que aprobarlo otra vez lo REAPLIQUE. Entidad por entidad: se aplica dos veces el mismo cambio con
 * la función de verdad (`aplicarCambioPendiente`, sesión de Dirección y servicio para Storage) y se compara lo que
 * queda después de la primera con lo que queda después de la segunda. Idempotente = la segunda no lanza y no
 * cambia nada (ni datos, ni ficheros, ni la marca de cobro). El mandato se mide en `prueba-tras-validar` (su
 * montaje, con la firma sellada, vive allí). Fixtures ficticios del 2026-11-27.
 */

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n')

describe('reaplicar un cambio de la cola: ¿es inofensivo? (medido antes de construir)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let nino: TestNino
  let admin: TestUser
  let tutora: TestUser
  let cAdmin: SupabaseClient<Database>
  let comedor = ''
  const subidos: [string, string][] = []

  async function subir(bucket: string, ruta: string) {
    const { error } = await serviceClient.storage
      .from(bucket)
      .upload(ruta, PDF, { contentType: 'application/pdf' })
    if (error) throw new Error(`subir ${bucket}/${ruta}: ${error.message}`)
    subidos.push([bucket, ruta])
  }
  /** Los ficheros de la carpeta del niño en un bucket, ordenados. */
  async function ficheros(bucket: string): Promise<string[]> {
    const { data, error } = await serviceClient.storage
      .from(bucket)
      .list(`${centro.id}/${nino.id}`, { limit: 1000 })
    if (error) throw new Error(`listar ${bucket}: ${error.message}`)
    return (data ?? [])
      .filter((o) => o.id !== null)
      .map((o) => o.name)
      .sort()
  }
  /** Una fila quitando las marcas de tiempo que cambian con cualquier UPDATE. */
  const sinTiempos = (f: Record<string, unknown> | null) =>
    f ? Object.fromEntries(Object.entries(f).filter(([k]) => !/(_at|updated)$/.test(k))) : null

  const fila = (entidad: string, payload: unknown): CambioRow => ({
    entidad,
    centro_id: centro.id,
    nino_id: nino.id,
    payload,
  })

  /** Aplica dos veces; devuelve lo que queda tras cada una y el error de la segunda. */
  async function dosVeces<T>(row: CambioRow, foto: () => Promise<T>) {
    await aplicarCambioPendiente(cAdmin, serviceClient, row)
    const tras1 = await foto()
    let error2: string | null = null
    try {
      await aplicarCambioPendiente(cAdmin, serviceClient, row)
    } catch (e) {
      error2 = e instanceof Error ? e.message : String(e)
    }
    const tras2 = await foto()
    console.warn(
      `reaplicar ${row.entidad}:`,
      JSON.stringify({ error2, igual: JSON.stringify(tras1) === JSON.stringify(tras2) })
    )
    return { tras1, tras2, error2 }
  }

  const ninoFila = async () =>
    sinTiempos(
      (await serviceClient.from('ninos').select('*').eq('id', nino.id).single()).data as Record<
        string,
        unknown
      >
    )
  const tutorFila = async () =>
    sinTiempos(
      (
        await serviceClient
          .from('familia_tutores')
          .select('*')
          .eq('familia_id', nino.familia_id)
          .eq('rol_familia', 'titular')
          .single()
      ).data as Record<string, unknown>
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro Reaplicar')
    curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Reaplicar')
    // Matrícula activa: el alta está validada (`alta_validada_de_nino`), como en la cola de verdad.
    await matricular(nino.id, aula.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Reaplicar' })
    tutora = await createTestUser({ nombre: 'Tutora Reaplicar' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(nino.familia_id, tutora.id, 'titular')
    await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal')
    cAdmin = await clientFor(admin)
    const { data: c, error: cErr } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Comedor mensual',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        aplicacion: 'manual',
        servicio: 'comedor',
        importe_centimos: 9000,
      } as never)
      .select('id')
      .single()
    if (cErr || !c) throw new Error(`concepto: ${cErr?.message}`)
    comedor = c.id
  }, 120_000)

  afterAll(async () => {
    for (const [b, r] of subidos) await serviceClient.storage.from(b).remove([r])
    await deleteTestCentro(centro.id)
    for (const u of [admin, tutora]) await deleteTestUser(u.id)
  }, 120_000)

  it('datos del niño · domicilio (ninos_familia)', async () => {
    const r = await dosVeces(
      fila('ninos_familia', { direccion_calle: 'Calle Reaplicar 1' }),
      ninoFila
    )
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('datos del niño · identidad (ninos_identidad)', async () => {
    const r = await dosVeces(fila('ninos_identidad', { nacionalidad: 'Española' }), ninoFila)
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('datos del tutor (datos_tutor)', async () => {
    const r = await dosVeces(
      fila('datos_tutor', { tipo_vinculo: 'tutor_legal_principal', telefono: '600000017' }),
      tutorFila
    )
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('documentos · libro de familia: el vigente no se borra al reaplicar', async () => {
    const viejo = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
    const nuevo = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
    await subir(BUCKET_LIBRO_FAMILIA, viejo)
    await subir(BUCKET_LIBRO_FAMILIA, nuevo)
    await serviceClient.from('ninos').update({ libro_familia_path: viejo }).eq('id', nino.id)
    const foto = async () => ({
      ruta: (await ninoFila())?.libro_familia_path,
      ficheros: await ficheros(BUCKET_LIBRO_FAMILIA),
    })
    const r = await dosVeces(fila('ninos_libro_familia', { path: nuevo }), foto)
    expect(r.tras1, 'premisa: la primera aplica (ruta nueva, el viejo borrado)').toEqual({
      ruta: nuevo,
      ficheros: [nuevo.split('/').pop()],
    })
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('documentos · tarjeta sanitaria: el vigente no se borra al reaplicar', async () => {
    const nuevo = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
    await subir(BUCKET_SIP_NINOS, nuevo)
    const foto = async () => ({
      ficheros: await ficheros(BUCKET_SIP_NINOS),
    })
    const r = await dosVeces(fila('ninos_sip_documento', { path: nuevo }), foto)
    expect(r.tras1.ficheros, 'premisa: el fichero está tras la primera').toContain(
      nuevo.split('/').pop()
    )
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('documentos · DNI del tutor: el vigente no se borra al reaplicar', async () => {
    const nuevo = `${centro.id}/${nino.id}/dni-titular-${randomUUID()}.pdf`
    await subir(BUCKET_DNI_TUTORES, nuevo)
    const foto = async () => ({
      ruta: (await tutorFila())?.dni_documento_path ?? null,
      ficheros: await ficheros(BUCKET_DNI_TUTORES),
    })
    const r = await dosVeces(
      fila('datos_tutor_dni', { tipo_vinculo: 'tutor_legal_principal', path: nuevo }),
      foto
    )
    expect(r.tras1.ficheros, 'premisa: el fichero está tras la primera').toContain(
      nuevo.split('/').pop()
    )
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('servicios (peticion_servicios): ni una mensual de más ni una fecha movida', async () => {
    const foto = async () => ({
      asignaciones: (
        await serviceClient
          .from('asignacion_concepto')
          .select('id, concepto_id, vigencia_desde, vigencia_hasta, deleted_at')
          .eq('nino_id', nino.id)
          .order('id')
      ).data,
      respuestas: (
        await serviceClient
          .from('peticion_servicio')
          .select('servicio, respuesta, concepto_id')
          .eq('nino_id', nino.id)
          .order('servicio')
      ).data,
    })
    const r = await dosVeces(
      fila('peticion_servicios', {
        respuestas: [{ servicio: 'comedor', respuesta: 'mensual', concepto_id: comedor }],
      }),
      foto
    )
    expect(r.tras1.asignaciones, 'premisa: la primera pone la mensual').toHaveLength(1)
    expect(r.error2).toBeNull()
    expect(r.tras2).toEqual(r.tras1)
  })

  it('gastos de gestión (gastos_gestion): reaplicar no toca la marca de cobro', async () => {
    const { error: fErr } = await cAdmin.rpc('fijar_gastos_gestion_curso', {
      p_curso_academico_id: curso.id,
      p_importe_centimos: 5000,
    })
    if (fErr) throw new Error(`fijar el curso: ${fErr.message}`)
    const row = fila('gastos_gestion', { curso_academico_id: curso.id, forma: 'efectivo' })
    await aplicarCambioPendiente(cAdmin, serviceClient, row)
    // Entre la primera y la segunda, Dirección marca el cobro: lo que reaplicar no puede deshacer.
    const { error: mErr } = await cAdmin.rpc('marcar_cobro_gastos_gestion', {
      p_nino_id: nino.id,
      p_curso_academico_id: curso.id,
      p_cobrado: true,
    })
    if (mErr) throw new Error(`marcar cobro: ${mErr.message}`)
    const foto = async () =>
      (
        await serviceClient
          .from('gastos_gestion')
          .select('*')
          .eq('nino_id', nino.id)
          .eq('curso_academico_id', curso.id)
          .single()
      ).data
    const antes = await foto()
    expect(antes?.cobrado_at ?? null, 'premisa: el cobro está marcado').not.toBeNull()
    let error2: string | null = null
    try {
      await aplicarCambioPendiente(cAdmin, serviceClient, row)
    } catch (e) {
      error2 = e instanceof Error ? e.message : String(e)
    }
    const despues = await foto()
    console.warn(
      'reaplicar gastos_gestion:',
      JSON.stringify({ error2, igual: JSON.stringify(antes) === JSON.stringify(despues) })
    )
    expect(error2).toBeNull()
    expect(despues).toEqual(antes)
  })
})
