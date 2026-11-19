import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  firmarFichaNino,
  leerEstadoFirmaFicha,
  leerFichaParaFirmar,
  leerUltimaFirmaFicha,
  pedirRefirmaFicha,
} from '@/features/alta/lib/ficha-firmada'
import { fichaLegible } from '@/features/alta/lib/ficha-legible'
import { comprobarAlta } from '@/features/alta/lib/gate-alta'
import { leerRespuestaImagen } from '@/features/alta/lib/respuesta-imagen'
import { titularRespuestaImagen } from '@/features/alta/lib/titular-respuesta-imagen'
import { getTutoresSinAccesoFicha } from '@/features/alta/queries/get-tutores-sin-acceso-ficha'
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

const SIN_CONTEXTO = { ip: null, userAgent: null }
const TRAZO = 'data:image/png;base64,iVBORw0KGgo='

/**
 * Fase 10b-2 — las pantallas de la ficha firmada, con las sesiones de verdad (spec
 * `docs/specs/altas-serie.md`, «10b-2: el diseño» y «Las dos de la 10b-2, resueltas»). Lo que la app
 * hace sobre la base de la 10b-1: abrir la ficha (deja su lectura), firmar como último paso con el
 * gate de completitud delante, el tutor sin acceso a la ficha médica, la lista de Dirección, pedir
 * la refirma, y la respuesta de imagen del alta en papel a nombre del tutor que firmó el papel, nunca
 * de la persona de Dirección.
 *
 * Cada `it` parte del estado que deja el anterior.
 */
describe('la ficha firmada en la app (fase 10b-2)', () => {
  let centro: { id: string }
  let N: string
  /** Un niño del mismo centro sin ningún tutor legal (el alta en papel sin cuenta). */
  let sinTutor: string
  let legalA: TestUser
  let legalB: TestUser
  let direccion: TestUser
  let vinculoB: string
  const s = {} as Record<'A' | 'B' | 'dir', Cliente>
  const ids: string[] = []
  let hashVisto = ''

  const nFirmas = () =>
    comoPostgres(`SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}'`)
  const nLecturasAlta = () =>
    comoPostgres(
      `SELECT count(*) FROM public.lecturas_ficha_medica WHERE nino_id = '${N}' AND origen = 'alta'`
    )
  const matricula = async () =>
    (await serviceClient.from('matriculas').select('estado').eq('nino_id', N).single()).data?.estado

  beforeAll(async () => {
    centro = await createTestCentro('Centro Ficha Pantalla')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    N = (await createTestNino(centro.id, 'Nino Ficha Pantalla')).id
    sinTutor = (await createTestNino(centro.id, 'Nino Sin Tutor Pantalla')).id
    await matricular(N, aula.id, curso.id)
    await matricular(sinTutor, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A Pantalla' })
    legalB = await createTestUser({ nombre: 'Legal B Pantalla' })
    direccion = await createTestUser({ nombre: 'Direccion Pantalla' })
    ids.push(legalA.id, legalB.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(legalA.id, centro.id, 'tutor_legal')
    await asignarRol(legalB.id, centro.id, 'tutor_legal')
    await crearVinculo(N, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    vinculoB = await crearVinculo(N, legalB.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: true,
    })
    // El alta, completa salvo la imagen, para la base Y para el gate de la app. El gate lee el perfil
    // de los tutores en `familia_tutores` con la sesión de quien firma: sin las filas de A y B con su
    // cuenta, `completarTutoresAlta` crea un titular sin cuenta que A no ve, y para la app «falta el
    // tutor 1» y su DNI (medido en la CI el 2026-11-18: la base cerraba y el gate decía
    // `['tutor1', 'documentos', 'imagen']`). En la app el tutor con cuenta siempre tiene su fila.
    const familia = (await serviceClient.from('ninos').select('familia_id').eq('id', N).single())
      .data?.familia_id
    if (!familia) throw new Error('el niño no tiene familia')
    await crearFamiliaTutor(familia, legalA.id, 'titular')
    await crearFamiliaTutor(familia, legalB.id, 'segundo_tutor')
    await completarDatosAlta(N)
    // El libro de familia se deja SIN subir: lo pone el it de «firmar sin respuesta de imagen».
    const acuse = await serviceClient.from('consentimientos').insert({
      usuario_id: legalA.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
      nino_id: N,
    })
    if (acuse.error) throw new Error(`acuse: ${acuse.error.message}`)
    for (const id of [N, sinTutor]) {
      const p = await serviceClient
        .from('matriculas')
        .update({ estado: 'pendiente' })
        .eq('nino_id', id)
      if (p.error) throw new Error(p.error.message)
    }
    s.A = await clientFor(legalA)
    s.B = await clientFor(legalB)
    s.dir = await clientFor(direccion)
  }, 120_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  it('P1 premisa: A y B tutores legales con la ficha médica, sin firma, sin imagen y en alta', async () => {
    expect(
      comoPostgres(
        `SELECT string_agg(tipo_vinculo::text || ':' || coalesce(permisos->>'puede_ver_info_medica', '-'), ',' ORDER BY tipo_vinculo)
           FROM public.vinculos_familiares WHERE nino_id = '${N}' AND deleted_at IS NULL`
      )
    ).toBe('tutor_legal_principal:true,tutor_legal_secundario:true')
    const e = await leerEstadoFirmaFicha(s.A, N)
    expect(e).toEqual({
      ok: true,
      data: {
        firmada: false,
        vigente: false,
        ultimaFirmaEn: null,
        refirmaPedida: false,
        puedeFirmar: 'si',
      },
    })
    expect(await leerRespuestaImagen(s.A, N, legalA.id)).toEqual({ ok: true, respuesta: null })
    expect(nFirmas()).toBe('0')
    expect(await matricula()).toBe('pendiente')
  })

  it('abrir la ficha: la foto en palabras y su sello, y deja su lectura en el registro', async () => {
    const antes = Number(nLecturasAlta())
    const r = await leerFichaParaFirmar(s.A, N)
    if (!r.ok) throw new Error(r.error)
    expect(r.data.hash).toMatch(/^[0-9a-f]{64}$/)
    hashVisto = r.data.hash
    expect(Number(nLecturasAlta())).toBe(antes + 1)
    // Una sección por tutor de la familia (la cuenta de la base, no un número supuesto), y sin servicios,
    // gastos ni respuestas de imagen, que este alta no tiene.
    const tutores = Number(
      comoPostgres(
        `SELECT count(*) FROM public.familia_tutores ft JOIN public.ninos n ON n.familia_id = ft.familia_id
          WHERE n.id = '${N}' AND ft.deleted_at IS NULL`
      )
    )
    expect(tutores).toBeGreaterThan(0)
    const secciones = fichaLegible(
      r.data.ficha,
      (k) => k,
      () => null
    ).map((x) => x.seccion)
    expect(secciones).toEqual(['nino', ...Array(tutores).fill('tutor'), 'pedagogicos', 'medico'])
  })

  it('firmar con el alta incompleta: el gate lo dice entero, como «Finalizar», y no queda firma', async () => {
    // Premisa: para la app faltan el libro de familia y la respuesta de imagen, y nada más.
    expect(await comprobarAlta(s.A, N, legalA.id, false)).toEqual({
      ok: true,
      faltan: ['documentos', 'imagen'],
    })
    const r = await firmarFichaNino(
      s.A,
      legalA.id,
      { ninoId: N, hashVisto, nombreTecleado: 'Legal A Pantalla', firmaImagen: TRAZO },
      SIN_CONTEXTO
    )
    // Los dos bloques: la base solo frena por la imagen (y solo diría el primero), y el libro de
    // familia no lo mira: sin el gate, la firma cerraba el alta sin él (medido en la CI, 2026-11-18,
    // la sonda que quita el gate de `firmarFichaNino`).
    expect(r).toEqual({
      ok: false,
      error: 'alta.errors.incompleto',
      faltan: ['documentos', 'imagen'],
    })
    expect(nFirmas()).toBe('0')
    expect(await matricula()).toBe('pendiente')
    // Se sube el libro: para la app ya solo falta la imagen.
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
      .eq('id', N)
    expect(libro.error).toBeNull()
    expect(await comprobarAlta(s.A, N, legalA.id, false)).toEqual({ ok: true, faltan: ['imagen'] })
  })

  it('el titular de la respuesta en papel: el tutor que nombra Dirección, nunca Dirección (N2)', async () => {
    // Premisa: Dirección no tiene vínculo con el niño (es el alta en papel) y A sí.
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.vinculos_familiares WHERE nino_id = '${N}' AND usuario_id = '${direccion.id}'`
      )
    ).toBe('0')
    expect(await titularRespuestaImagen(s.dir, N, direccion.id, undefined)).toEqual({
      ok: false,
      error: 'alta.errors.tutor_papel',
    })
    // La puerta de N2 en la app: Dirección no puede ponerse a sí misma como titular.
    expect(await titularRespuestaImagen(s.dir, N, direccion.id, direccion.id)).toEqual({
      ok: false,
      error: 'alta.errors.tutor_papel',
    })
    expect(await titularRespuestaImagen(s.dir, N, direccion.id, legalA.id)).toEqual({
      ok: true,
      tutor: legalA.id,
      metodo: 'presencial',
    })
    // La familia contesta por sí: lo que mande como tutor no cuenta.
    expect(await titularRespuestaImagen(s.A, N, legalA.id, direccion.id)).toEqual({
      ok: true,
      tutor: legalA.id,
      metodo: 'checkbox',
    })
  })

  it('Dirección anota el «sí» del papel a nombre de A: A tiene respuesta, Dirección no', async () => {
    const r = await s.dir.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_version: 'imagen-v1',
      p_metodo: 'presencial',
    })
    expect(r.error).toBeNull()
    // Dirección lee la respuesta de A (`consentimientos_admin_select`): así la pantalla del papel.
    expect(await leerRespuestaImagen(s.dir, N, legalA.id)).toEqual({ ok: true, respuesta: 'si' })
    expect(await leerRespuestaImagen(s.dir, N, direccion.id)).toEqual({ ok: true, respuesta: null })
  })

  it('el gate del papel: con un tutor con respuesta no falta la imagen; sin ningún tutor, falta la cuenta', async () => {
    const conTutor = await comprobarAlta(s.dir, N, direccion.id, true)
    if (!conTutor.ok) throw new Error('el gate no leyó')
    expect(conTutor.faltan).not.toContain('imagen')
    expect(conTutor.faltan).not.toContain('tutor_sin_cuenta')
    // Premisa: el otro niño no tiene ningún tutor legal.
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.vinculos_familiares WHERE nino_id = '${sinTutor}' AND deleted_at IS NULL`
      )
    ).toBe('0')
    const sin = await comprobarAlta(s.dir, sinTutor, direccion.id, true)
    if (!sin.ok) throw new Error('el gate no leyó')
    expect(sin.faltan).toContain('tutor_sin_cuenta')
    expect(sin.faltan).not.toContain('imagen')
  })

  it('si tutores_de_familia falla, Dirección en papel no lo lee como «lo gestiona el otro»: no se cierra', async () => {
    // Todas las filas son ajenas a Dirección: sin `personalesLeidos`, un fallo de la función (todo
    // `ve_personales` en falso) pasaría por la regla de la fase 6, «lo juzga la base». Con A como quien
    // cierra no se mediría: su propia fila ilegible ya frena sola (2026-11-19).
    // Premisa: con la función, el gate del papel lee (no se rinde) y los dos tutores tienen cuenta.
    expect((await comprobarAlta(s.dir, N, direccion.id, true)).ok).toBe(true)
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.familia_tutores ft JOIN public.ninos n ON n.familia_id = ft.familia_id
          WHERE n.id = '${N}' AND ft.deleted_at IS NULL AND ft.usuario_id IS NOT NULL`
      )
    ).toBe('2')
    comoPostgres('REVOKE EXECUTE ON FUNCTION public.tutores_de_familia(uuid) FROM authenticated')
    try {
      expect(await comprobarAlta(s.dir, N, direccion.id, true)).toEqual({ ok: false })
    } finally {
      comoPostgres('GRANT EXECUTE ON FUNCTION public.tutores_de_familia(uuid) TO authenticated')
    }
    // Repuesto: vuelve a leer.
    expect((await comprobarAlta(s.dir, N, direccion.id, true)).ok).toBe(true)
  })

  it('A firma: firmar es finalizar (matrícula en lista, una firma, y vale)', async () => {
    const r = await firmarFichaNino(
      s.A,
      legalA.id,
      { ninoId: N, hashVisto, nombreTecleado: 'Legal A Pantalla', firmaImagen: TRAZO },
      SIN_CONTEXTO
    )
    expect(r.ok).toBe(true)
    expect(nFirmas()).toBe('1')
    expect(await matricula()).toBe('lista')
    const e = await leerEstadoFirmaFicha(s.dir, N)
    expect(e.ok && e.data.firmada && e.data.vigente).toBe(true)
    const u = await leerUltimaFirmaFicha(s.dir, N)
    expect(u.ok && u.data).toMatchObject({ metodo: 'digital', firmanteId: legalA.id })
  })

  it('volver a firmar con la firma vigente: «ya firmada», y no se añade otra', async () => {
    const r = await firmarFichaNino(
      s.B,
      legalB.id,
      { ninoId: N, hashVisto, nombreTecleado: 'Legal B Pantalla', firmaImagen: TRAZO },
      SIN_CONTEXTO
    )
    expect(r).toEqual({ ok: false, error: 'alta.firma.errors.ya_firmada' })
    expect(nFirmas()).toBe('1')
  })

  it('B sin acceso a la ficha médica: el estado lo dice, la ficha no se abre, y Dirección lo ve en su lista cuando hay que firmar', async () => {
    const quitar = await serviceClient
      .from('vinculos_familiares')
      .update({ permisos: { puede_ver_info_medica: false } })
      .eq('id', vinculoB)
    expect(quitar.error).toBeNull()
    const e = await leerEstadoFirmaFicha(s.B, N)
    expect(e.ok && e.data.puedeFirmar).toBe('sin_acceso_ficha_medica')
    expect(await leerFichaParaFirmar(s.B, N)).toEqual({
      ok: false,
      error: 'alta.firma.errors.sin_acceso',
    })
    // Con la firma vigente el alta no espera firma: B no sale en la lista.
    expect(await getTutoresSinAccesoFicha(s.dir, centro.id)).toEqual([])
    // Cambia un dato sellado (Dirección, con su sesión): la firma deja de valer, y B sale.
    const cambio = await s.dir
      .from('ninos')
      .update({ lugar_nacimiento: 'Lugar Pantalla 2' })
      .eq('id', N)
      .select('id')
    expect(cambio.data).toHaveLength(1)
    const e2 = await leerEstadoFirmaFicha(s.dir, N)
    expect(e2.ok && e2.data.vigente).toBe(false)
    const lista = await getTutoresSinAccesoFicha(s.dir, centro.id)
    expect(lista?.map((t) => `${t.ninoId}:${t.tipoVinculo}`)).toEqual([
      `${N}:tutor_legal_secundario`,
    ])
  })

  // OJO: el «sin_firma» de abajo es el HUECO medido el 2026-11-18, no el estado bueno: un alta que
  // se cerró sin ficha firmada (las `activa` de antes y la que se cierre en papel antes de la 10b-3)
  // no se puede pedir que se firme, y fuera de `lista` sin esa petición no firma nadie. La 10b-3 deja
  // pedirla sin firma previa: entonces este aserto se pone rojo y se da la vuelta, a propósito
  // (spec, «Las dos, confirmadas»).
  it('pedir la refirma: con firma, sí; sin firma, hoy «sin_firma» (el hueco que cierra la 10b-3)', async () => {
    const r = await pedirRefirmaFicha(s.dir, N)
    expect(r.ok).toBe(true)
    const e = await leerEstadoFirmaFicha(s.dir, N)
    expect(e.ok && e.data.refirmaPedida).toBe(true)
    expect(await pedirRefirmaFicha(s.dir, sinTutor)).toEqual({
      ok: false,
      error: 'alta.firma.errors.sin_firma',
    })
  })
})
