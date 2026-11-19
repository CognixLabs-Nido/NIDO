import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { leerFichaParaFirmar } from '@/features/alta/lib/ficha-firmada'
import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import {
  asignarRol,
  clientFor,
  completarDatosAlta,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

type Cliente = SupabaseClient<Database>

const TRAZO = 'data:image/png;base64,iVBORw0KGgo='

/**
 * Fase 10b-3, segunda migración (`20270130120000_feat_alta_exige_ficha_firmada`): la base exige lo
 * que hasta entonces solo vigilaba la pantalla (spec `docs/specs/altas-serie.md`, «La 10b-3 cierra el
 * punto 3 entero»). `marcar_matricula_lista`, con el alta pendiente, exige el libro de familia, una
 * firma de la ficha que valga y la respuesta de imagen del tutor de ESA firma; `validar_alta`, la
 * firma. Firmar sigue cerrando: la firma entra antes de llamar al cierre.
 *
 * Los casos se deshacen solos: cada uno vuelve el alta a `pendiente` y quita lo que puso.
 */
describe('el alta exige la ficha firmada (10b-3, migración 2)', () => {
  let centro: { id: string }
  let N: string
  let mat: string
  let legalA: TestUser
  let direccion: TestUser
  const s = {} as Record<'A' | 'dir', Cliente>
  const ids: string[] = []

  const estado = async () =>
    (await serviceClient.from('matriculas').select('estado').eq('id', mat).single()).data?.estado
  const aPendiente = async () => {
    // Las firmas no se borran con sesión ni con el servicio (inmutables): como postgres, que es el
    // dueño, y solo en la base del CI.
    comoPostgres(`DELETE FROM public.firmas_ficha WHERE nino_id = '${N}'`)
    comoPostgres(`DELETE FROM public.refirmas_ficha WHERE nino_id = '${N}'`)
    const p = await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('id', mat)
    if (p.error) throw new Error(p.error.message)
  }
  const cierra = (c: Cliente) => c.rpc('marcar_matricula_lista', { p_nino_id: N })
  const firma = async () => {
    const v = await leerFichaParaFirmar(s.A, N)
    if (!v.ok) throw new Error(v.error)
    return s.A.rpc('firmar_ficha', {
      p_nino_id: N,
      p_hash_visto: v.data.hash,
      p_nombre_tecleado: 'Legal A Cierre',
      p_firma_imagen: TRAZO,
    })
  }
  const siDeA = () =>
    s.A.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_metodo: 'checkbox',
    })
  const sinRespuestaDeA = () =>
    comoPostgres(
      `UPDATE public.consentimientos SET revocado_en = now()
        WHERE nino_id = '${N}' AND usuario_id = '${legalA.id}' AND tipo::text IN ('imagen', 'imagen_denegada') AND revocado_en IS NULL`
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro Ficha Cierre')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    N = (await createTestNino(centro.id, 'Nino Ficha Cierre')).id
    await matricular(N, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A Cierre' })
    direccion = await createTestUser({ nombre: 'Direccion Cierre' })
    ids.push(legalA.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(legalA.id, centro.id, 'tutor_legal')
    await crearVinculo(N, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    const familia = (await serviceClient.from('ninos').select('familia_id').eq('id', N).single())
      .data?.familia_id
    if (!familia) throw new Error('el niño no tiene familia')
    await crearFamiliaTutor(familia, legalA.id, 'titular')
    await completarDatosAlta(N)
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
      .eq('id', N)
    if (libro.error) throw new Error(`libro: ${libro.error.message}`)
    for (const u of [legalA, direccion]) {
      const acuse = await serviceClient.from('consentimientos').insert({
        usuario_id: u.id,
        tipo: 'datos_medicos',
        version: 'v2.0',
        metodo_firma: 'digital',
        nino_id: N,
      })
      if (acuse.error) throw new Error(`acuse: ${acuse.error.message}`)
    }
    mat = (await serviceClient.from('matriculas').select('id').eq('nino_id', N).single()).data!.id
    s.A = await clientFor(legalA)
    s.dir = await clientFor(direccion)
    const si = await siDeA()
    if (si.error) throw new Error(`imagen: ${si.error.message}`)
    await aPendiente()
  }, 120_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  it('premisa: alta pendiente, completa, con la respuesta de imagen de A y sin ninguna firma', async () => {
    expect(await estado()).toBe('pendiente')
    expect(
      comoPostgres(
        `SELECT coalesce(privado.respuesta_imagen('${legalA.id}', '${N}'), '-') || '|' ||
                (SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}')`
      )
    ).toBe('si|0')
  })

  it('sin firmar, la llamada directa al cierre ya no cierra (ficha_sin_firmar)', async () => {
    const r = await cierra(s.A)
    expect(r.error?.hint).toBe('ficha_sin_firmar')
    expect(await estado()).toBe('pendiente')
  })

  it('control positivo: firmar sigue cerrando el alta', async () => {
    const r = await firma()
    expect(r.error).toBeNull()
    expect(await estado()).toBe('lista')
    await aPendiente()
  })

  it('sin libro de familia no cierra, aunque firme (libro_familia_por_subir)', async () => {
    const quita = await serviceClient.from('ninos').update({ libro_familia_path: null }).eq('id', N)
    expect(quita.error).toBeNull()
    try {
      const r = await firma()
      expect(r.error?.hint).toBe('libro_familia_por_subir')
      expect(await estado()).toBe('pendiente')
    } finally {
      await serviceClient
        .from('ninos')
        .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
        .eq('id', N)
      await aPendiente()
    }
  })

  it('la respuesta de imagen que mira es la del tutor de la firma', async () => {
    // A firma (con su «sí»), el alta vuelve a pendiente con la firma valiendo, y A deja de tener
    // respuesta: el cierre lo dice, aunque la firma valga.
    expect((await firma()).error).toBeNull()
    const p = await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('id', mat)
    expect(p.error).toBeNull()
    sinRespuestaDeA()
    try {
      // Premisa: la firma vale.
      expect(comoPostgres(`SELECT (privado.firma_ficha_vigente('${N}') IS NOT NULL)::text`)).toBe(
        'true'
      )
      const r = await cierra(s.A)
      expect(r.error?.hint).toBe('imagen_sin_respuesta')
      expect(await estado()).toBe('pendiente')
    } finally {
      expect((await siDeA()).error).toBeNull()
      await aPendiente()
    }
  })

  it('una firma que ya no vale no cierra: un dato firmado cambió (ficha_sin_firmar)', async () => {
    expect((await firma()).error).toBeNull()
    const p = await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('id', mat)
    expect(p.error).toBeNull()
    const cambio = await serviceClient
      .from('ninos')
      .update({ lugar_nacimiento: 'Otro Lugar Cierre' })
      .eq('id', N)
    expect(cambio.error).toBeNull()
    try {
      const r = await cierra(s.A)
      expect(r.error?.hint).toBe('ficha_sin_firmar')
    } finally {
      await serviceClient.from('ninos').update({ lugar_nacimiento: 'Lugar Demo' }).eq('id', N)
      await aPendiente()
    }
  })

  it('validar: sin firma, no; con la firma que vale, sí; con la firma ya sin valor, no', async () => {
    const validar = () =>
      s.dir.rpc('validar_alta', { p_matricula_id: mat, p_fecha_incorporacion: '2027-09-01' })
    // Sin ninguna firma (un alta en `lista` de antes, puesta como postgres).
    const lista = await serviceClient.from('matriculas').update({ estado: 'lista' }).eq('id', mat)
    expect(lista.error).toBeNull()
    let v = await validar()
    expect(v.error?.hint).toBe('ficha_sin_firmar')
    expect(await estado()).toBe('lista')
    // Firmada en `lista` (sin que nadie lo pida: la firma no vale porque no hay), y un dato cambia.
    expect((await firma()).error).toBeNull()
    await serviceClient.from('ninos').update({ lugar_nacimiento: 'Otro Lugar Cierre' }).eq('id', N)
    v = await validar()
    expect(v.error?.hint).toBe('ficha_sin_firmar')
    expect(await estado()).toBe('lista')
    // Vuelve a firmar con lo que hay ahora: se valida.
    expect((await firma()).error).toBeNull()
    v = await validar()
    expect(v.error).toBeNull()
    expect(await estado()).toBe('activa')
  })
})
