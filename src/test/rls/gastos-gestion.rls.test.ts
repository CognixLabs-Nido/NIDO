import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import { recolectarAdjuntosDe } from '@/features/olvido/lib/fuentes-adjuntos'
import { BUCKET_JUSTIFICANTES_GESTION } from '@/shared/lib/adjuntos/storage'
import type { Database } from '@/types/db'

import {
  asignarRol,
  clientFor,
  completarDatosAlta,
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

type Cliente = SupabaseClient<Database>

/**
 * Fase 9 — los gastos de gestión (`20270123120000`; spec `docs/specs/altas-serie.md`, «Fase 9»).
 * Decidido (2026-10-29 y 2026-11-16):
 *
 *  - el tutor adjunta el justificante de la transferencia o dice que pagará en efectivo; sin
 *    bloqueo ni «exento» (D5); sin recibo, solo la marca de cobro (D6); el justificante en su
 *    bucket, y la purga llega a sus ficheros (D8);
 *  - cada curso, también los que siguen, y por niño; el centro fija un importe por curso, que es una
 *    propuesta: Dirección pone otro o cero cuando quiere, y queda en la auditoría; sin importe, nada;
 *  - después del alta, por la cola; Dirección marca el cobro y ve la lista de los que faltan.
 *
 * La renovación: el niño que sigue debe los del curso siguiente desde que Dirección le propone la
 * matrícula (la `pendiente` que crea «pasar de curso»), como los documentos de curso.
 */

const PDF = Buffer.from('%PDF-1.4\n%demo\n')
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const CURSO_A = 6_000
const CURSO_B = 6_500

describe('Los gastos de gestión (fase 9)', () => {
  let centro: { id: string }
  let otro: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let cerrado: { id: string }
  let aulaA: { id: string }
  let admin: TestUser
  let madre: TestUser
  let tio: TestUser
  let profe: TestUser
  let adminOtro: TestUser
  const s = {} as Record<'admin' | 'madre' | 'tio' | 'profe' | 'adminOtro', Cliente>
  /** N: en alta (pendiente en A). S: validado en A y propuesto para B (la renovación). */
  let N: string
  let S: string
  const subidos: string[] = []
  const ruta = (nino: string, nombre: string) => `${centro.id}/${nino}/${nombre}`

  type Fila = Database['public']['Functions']['gastos_gestion_nino']['Returns'][number]
  const leer = async (cliente: Cliente, nino: string) => {
    const { data, error } = await cliente.rpc('gastos_gestion_nino', { p_nino_id: nino })
    return { error, filas: ((data ?? []) as Fila[]).slice() }
  }
  const curso = (id: string | null) =>
    id === cursoA.id ? 'A' : id === cursoB.id ? 'B' : id === cerrado.id ? 'cerrado' : `? ${id}`
  const resumen = (filas: Fila[]) =>
    filas
      .map(
        (f) =>
          `${curso(f.curso_academico_id)}:${f.importe}:${f.forma ?? '-'}:${f.matricula_pendiente ? 't' : 'f'}`
      )
      .sort()
  const pendientes = async () => {
    const { data, error } = await s.admin.rpc('gastos_gestion_pendientes', {
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    return (data ?? [])
      .map(
        (p) =>
          `${p.nino_id === N ? 'N' : p.nino_id === S ? 'S' : p.nino_id}:${curso(p.curso_academico_id)}`
      )
      .sort()
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Gastos 9')
    otro = await createTestCentro('Centro Otro 9')
    cursoA = await createTestCurso(centro.id, 'activo')
    cursoB = await createTestCurso(centro.id, 'planificado')
    cerrado = await createTestCurso(centro.id, 'cerrado')
    aulaA = await createTestAula(centro.id, cursoA.id)
    // La configuración del aula en el curso siguiente (lo que hace «copiar configuración»).
    const ac = await serviceClient.from('aulas_curso').insert({
      centro_id: centro.id,
      aula_id: aulaA.id,
      curso_academico_id: cursoB.id,
      tramo_edad: [2024],
    })
    if (ac.error) throw new Error(`aulas_curso B: ${ac.error.message}`)

    admin = await createTestUser({ nombre: 'Admin 9' })
    madre = await createTestUser({ nombre: 'Madre 9' })
    tio = await createTestUser({ nombre: 'Tío 9' })
    profe = await createTestUser({ nombre: 'Profe 9' })
    adminOtro = await createTestUser({ nombre: 'Admin Otro 9' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(adminOtro.id, otro.id, 'admin')

    // N, en alta: matrícula pendiente en A.
    const n = await createTestNino(centro.id, 'Nuevo')
    await matricular(n.id, aulaA.id, cursoA.id)
    await completarDatosAlta(n.id)
    const p = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', n.id)
    if (p.error) throw new Error(p.error.message)
    N = n.id
    // S, que sigue: activa en A (validado) y la propuesta pendiente en B.
    const sg = await createTestNino(centro.id, 'Sigue')
    await matricular(sg.id, aulaA.id, cursoA.id)
    const pr = await serviceClient.from('matriculas').insert({
      nino_id: sg.id,
      aula_id: aulaA.id,
      curso_academico_id: cursoB.id,
      estado: 'pendiente',
    })
    if (pr.error) throw new Error(`propuesta: ${pr.error.message}`)
    S = sg.id
    for (const nino of [N, S]) {
      await crearVinculo(nino, madre.id, 'tutor_legal_principal')
      await crearVinculo(nino, tio.id, 'autorizado')
    }

    s.admin = await clientFor(admin)
    s.madre = await clientFor(madre)
    s.tio = await clientFor(tio)
    s.profe = await clientFor(profe)
    s.adminOtro = await clientFor(adminOtro)
  }, 120_000)

  afterAll(async () => {
    if (subidos.length)
      await serviceClient.storage.from(BUCKET_JUSTIFICANTES_GESTION).remove(subidos)
    for (const id of [centro?.id, otro?.id].filter(Boolean) as string[]) {
      await serviceClient.from('cambios_pendientes').delete().eq('centro_id', id)
      await deleteTestCentro(id)
    }
    for (const u of [admin, madre, tio, profe, adminOtro]) if (u) await deleteTestUser(u.id)
  }, 90_000)

  it('premisa: S es un alta validada y N no; sin importe, ninguno debe nada', async () => {
    const { data: vS } = await serviceClient.rpc(
      'alta_validada_de_nino' as never,
      { p_nino_id: S } as never
    )
    const { data: vN } = await serviceClient.rpc(
      'alta_validada_de_nino' as never,
      { p_nino_id: N } as never
    )
    expect([vS, vN]).toEqual([true, false])
    for (const nino of [N, S]) {
      const r = await leer(s.madre, nino)
      expect(r.error).toBeNull()
      expect(r.filas).toEqual([])
    }
    expect(await pendientes()).toEqual([])
  })

  it('el centro fija un importe por curso; el que sigue debe también el del curso siguiente', async () => {
    // La sesión de la familia no fija nada.
    const t = await s.madre.rpc('fijar_gastos_gestion_curso', {
      p_curso_academico_id: cursoA.id,
      p_importe_centimos: 1,
    })
    expect(t.error?.code).toBe('42501')
    for (const [k, imp] of [
      [cursoA.id, CURSO_A],
      [cursoB.id, CURSO_B],
    ] as const) {
      const { error } = await s.admin.rpc('fijar_gastos_gestion_curso', {
        p_curso_academico_id: k,
        p_importe_centimos: imp,
      })
      expect(error).toBeNull()
    }
    expect(resumen((await leer(s.madre, N)).filas)).toEqual([`A:${CURSO_A}:-:t`])
    expect(resumen((await leer(s.madre, S)).filas)).toEqual([
      `A:${CURSO_A}:-:f`,
      `B:${CURSO_B}:-:t`,
    ])
    expect(resumen((await leer(s.admin, S)).filas)).toEqual([
      `A:${CURSO_A}:-:f`,
      `B:${CURSO_B}:-:t`,
    ])
    // El autorizado, la profe y la Dirección de otro centro, no.
    for (const quien of ['tio', 'profe', 'adminOtro'] as const) {
      expect.soft((await leer(s[quien], S)).error?.code, quien).toBe('42501')
    }
    // Un curso cerrado no se toca.
    const c = await s.admin.rpc('fijar_gastos_gestion_curso', {
      p_curso_academico_id: cerrado.id,
      p_importe_centimos: 1,
    })
    expect(c.error?.hint).toBe('curso_cerrado')
  })

  it('la familia declara mientras el alta no está validada; después, por la cola', async () => {
    const decl = (cli: Cliente, nino: string, k: string, forma: string, path?: string) =>
      cli.rpc('declarar_gastos_gestion', {
        p_nino_id: nino,
        p_curso_academico_id: k,
        p_forma: forma,
        ...(path === undefined ? {} : { p_justificante_path: path }),
      })
    // Transferencia sin justificante: llega después.
    const a = await decl(s.madre, N, cursoA.id, 'transferencia')
    expect(a.error).toBeNull()
    expect(a.data).toBeNull()
    expect(resumen((await leer(s.madre, N)).filas)).toEqual([`A:${CURSO_A}:transferencia:t`])
    // Con el justificante: devuelve la ruta de antes (ninguna); el siguiente, la de este.
    const j1 = ruta(N, 'j1.pdf')
    const b = await decl(s.madre, N, cursoA.id, 'transferencia', j1)
    expect([b.error, b.data]).toEqual([null, null])
    const b2 = await decl(s.madre, N, cursoA.id, 'transferencia', ruta(N, 'j2.png'))
    expect([b2.error, b2.data]).toEqual([null, j1])
    // Lo que no vale.
    expect((await decl(s.madre, N, cursoA.id, 'efectivo', ruta(N, 'x.pdf'))).error?.hint).toBe(
      'forma'
    )
    expect((await decl(s.madre, N, cursoA.id, 'bizum')).error?.hint).toBe('forma')
    expect((await decl(s.madre, N, cursoB.id, 'efectivo')).error?.hint).toBe('curso_sin_gastos')
    expect((await decl(s.tio, N, cursoA.id, 'efectivo')).error?.code).toBe('42501')
    // S tiene el alta validada: la familia va por la cola; Dirección, directamente.
    expect((await decl(s.madre, S, cursoB.id, 'efectivo')).error?.hint).toBe('alta_validada')
    const ajena = await decl(s.admin, S, cursoB.id, 'transferencia', ruta(N, 'j.pdf'))
    expect(ajena.error?.code).toBe('23514')
    expect((await decl(s.admin, S, cursoB.id, 'efectivo')).error).toBeNull()
    // La tabla, la sesión no la escribe.
    const ins = await s.madre.from('gastos_gestion').insert({
      centro_id: centro.id,
      nino_id: N,
      curso_academico_id: cursoA.id,
      forma: 'efectivo',
    } as never)
    expect(ins.error?.code).toBe('42501')
  })

  it('la tabla la leen el tutor legal y Dirección; el autorizado y la profe, nada', async () => {
    const filas = async (cli: Cliente) =>
      (await cli.from('gastos_gestion').select('id').in('nino_id', [N, S])).data ?? []
    // Premisa: hay filas (las del test anterior) y la madre y Dirección las ven.
    expect((await filas(s.madre)).length).toBeGreaterThan(0)
    expect((await filas(s.admin)).length).toBe((await filas(s.madre)).length)
    expect(await filas(s.tio)).toEqual([])
    expect(await filas(s.profe)).toEqual([])
  })

  it('la cola admite la ruta del justificante del propio niño, PDF o imagen; la de otro, no', async () => {
    const encolar = (path: string) =>
      s.madre.from('cambios_pendientes').insert({
        centro_id: centro.id,
        nino_id: S,
        entidad: 'gastos_gestion',
        registro_id: S,
        payload: { curso_academico_id: cursoB.id, forma: 'transferencia', path },
        solicitado_por: madre.id,
      } as never)
    expect((await encolar(ruta(S, 'cola.png'))).error).toBeNull()
    expect((await encolar(ruta(N, 'cola.png'))).error?.code).toBe('23514')
    expect((await encolar(ruta(S, 'cola.exe'))).error?.code).toBe('23514')
  })

  it('el importe del curso es una propuesta: Dirección pone otro o cero, y queda a su nombre', async () => {
    const fija = (cli: Cliente, imp: number | null) =>
      cli.rpc('fijar_importe_gastos_gestion', {
        p_nino_id: S,
        p_curso_academico_id: cursoA.id,
        p_importe_centimos: imp as number,
      })
    expect((await fija(s.madre, 0)).error?.code).toBe('42501')
    expect((await fija(s.admin, 0)).error).toBeNull()
    const cero = (await leer(s.admin, S)).filas.find((f) => f.curso_academico_id === cursoA.id)
    expect([cero?.importe, cero?.importe_curso, cero?.importe_propio]).toEqual([0, CURSO_A, true])
    const { data: audit, error } = await serviceClient
      .from('audit_log')
      .select('accion, usuario_id, centro_id')
      .eq('tabla', 'gastos_gestion')
      .eq('valores_despues->>nino_id', S)
    expect(error).toBeNull()
    expect(audit).toContainEqual({ accion: 'INSERT', usuario_id: admin.id, centro_id: centro.id })
    // NULL vuelve al del curso.
    expect((await fija(s.admin, null)).error).toBeNull()
    const vuelta = (await leer(s.admin, S)).filas.find((f) => f.curso_academico_id === cursoA.id)
    expect([vuelta?.importe, vuelta?.importe_propio]).toEqual([CURSO_A, false])
  })

  it('Dirección marca el cobro cuando quiere y ve la lista de los que faltan', async () => {
    // Premisa: los tres pendientes (S/B tiene forma, pero no está cobrado).
    expect(await pendientes()).toEqual(['N:A', 'S:A', 'S:B'])
    const marca = (cli: Cliente, nino: string, k: string, cobrado: boolean) =>
      cli.rpc('marcar_cobro_gastos_gestion', {
        p_nino_id: nino,
        p_curso_academico_id: k,
        p_cobrado: cobrado,
      })
    expect((await marca(s.madre, N, cursoA.id, true)).error?.code).toBe('42501')
    // Sin que la familia haya contestado (S/A): también se marca.
    expect((await marca(s.admin, S, cursoA.id, true)).error).toBeNull()
    expect(await pendientes()).toEqual(['N:A', 'S:B'])
    const { data: fila } = await serviceClient
      .from('gastos_gestion')
      .select('cobrado_por')
      .eq('nino_id', S)
      .eq('curso_academico_id', cursoA.id)
      .single()
    expect(fila?.cobrado_por).toBe(admin.id)
    expect((await marca(s.admin, S, cursoA.id, false)).error).toBeNull()
    expect(await pendientes()).toEqual(['N:A', 'S:A', 'S:B'])
    // Un cero no es un pendiente.
    await s.admin.rpc('fijar_importe_gastos_gestion', {
      p_nino_id: S,
      p_curso_academico_id: cursoA.id,
      p_importe_centimos: 0,
    })
    expect(await pendientes()).toEqual(['N:A', 'S:B'])
    // La familia no ve la lista.
    const fam = await s.madre.rpc('gastos_gestion_pendientes', { p_centro_id: centro.id })
    expect(fam.error?.code).toBe('42501')
  })

  it('el bucket: la familia sube PDF o imagen a la carpeta de su hijo; el autorizado y la profe, no', async () => {
    const pdf = ruta(N, 'subido.pdf')
    const png = ruta(N, 'subido.png')
    const a = await s.madre.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(pdf, PDF, { contentType: 'application/pdf' })
    expect(a.error).toBeNull()
    subidos.push(pdf)
    const b = await s.madre.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(png, PNG, { contentType: 'image/png' })
    expect(b.error).toBeNull()
    subidos.push(png)
    const texto = await s.madre.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(ruta(N, 'nota.txt'), Buffer.from('hola'), { contentType: 'text/plain' })
    expect(texto.error).not.toBeNull()
    expect(
      (await s.tio.storage.from(BUCKET_JUSTIFICANTES_GESTION).download(pdf)).error
    ).not.toBeNull()
    expect(
      (await s.profe.storage.from(BUCKET_JUSTIFICANTES_GESTION).download(pdf)).error
    ).not.toBeNull()
    const sube = await s.tio.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(ruta(N, 'tio.pdf'), PDF, { contentType: 'application/pdf' })
    expect(sube.error).not.toBeNull()
  })

  it('sale en el export del niño', async () => {
    const { data, error } = await s.admin.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'nino',
      p_sujeto_id: N,
    })
    expect(error).toBeNull()
    const g = (data as { gastos_gestion?: Record<string, unknown>[] }).gastos_gestion ?? []
    expect(g.map((x) => [x.forma, x.con_justificante, x.importe_centimos, x.cobrado_en])).toEqual([
      ['transferencia', true, null, null],
    ])
  })

  it('D8: la purga del niño llega a los ficheros del bucket (y no a los de otro niño)', async () => {
    const otroFichero = ruta(S, 'de-otro.pdf')
    const o = await s.admin.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(otroFichero, PDF, { contentType: 'application/pdf' })
    expect(o.error).toBeNull()
    subidos.push(otroFichero)
    const lista = async (nino: string) =>
      (
        (
          await serviceClient.storage
            .from(BUCKET_JUSTIFICANTES_GESTION)
            .list(`${centro.id}/${nino}`)
        ).data ?? []
      )
        .map((x) => x.name)
        .sort()
    // Premisa (control positivo): los dos ficheros de N están, y el manifiesto los recoge.
    expect(await lista(N)).toEqual(['subido.pdf', 'subido.png'])
    const manifiesto = await recolectarAdjuntosDe(
      serviceClient,
      { sujeto_tipo: 'nino', sujeto_id: N, centro_id: centro.id },
      true
    )
    expect((manifiesto.get(BUCKET_JUSTIFICANTES_GESTION) ?? []).slice().sort()).toEqual([
      ruta(N, 'subido.pdf'),
      ruta(N, 'subido.png'),
    ])

    // La purga de verdad: la del olvido (borra los ficheros y después la base).
    const { data: sol, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: N,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    await purgarUno(serviceClient, {
      solicitud_id: sol as string,
      sujeto_tipo: 'nino',
      sujeto_id: N,
      centro_id: centro.id,
      gracia_hasta: new Date().toISOString(),
    })

    expect(await lista(N)).toEqual([])
    expect(await lista(S)).toEqual(['de-otro.pdf'])
    const { data: filas } = await serviceClient.from('gastos_gestion').select('id').eq('nino_id', N)
    expect(filas).toEqual([])
  })
})
