import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  leerFichaParaFirmar,
  registrarFirmaPresencialFicha,
} from '@/features/alta/lib/ficha-firmada'
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
 * Fase 10b-3, primera migración (`20270129120000_feat_ficha_puertas`): las puertas de la ficha
 * firmada, con las sesiones de verdad (spec `docs/specs/altas-serie.md`, «10b-3: el encargo, lo
 * medido abierto y el orden» y «La precisión de N2»).
 *
 * - La firma en papel dice de qué tutor legal es (`registrar_firma_ficha_presencial` con el tutor) y
 *   mira la respuesta de imagen de ese tutor, no la de Dirección, que solo la registra.
 * - Dirección pide la firma de un alta sin ninguna firma, y el tutor firma por la función.
 * - La vista de datos bloqueados enseña la ficha firmada del tutor olvidado, que la tabla oculta.
 * - El tutor que no ha contestado sabe si otro se ha opuesto a la imagen (`oposicion_imagen`).
 *
 * La puerta N2 del «sí» de imagen está en `consent-imagen-rpc-seguridad.rls.test.ts`, y su otra
 * entrada (`firma_imagen_sync`), en `roles-directora.rls.test.ts` y `superusuario.rls.test.ts`.
 *
 * Cada `it` parte del estado que deja el anterior.
 */
describe('las puertas de la ficha firmada (10b-3, migración 1)', () => {
  let centro: { id: string }
  /** El alta en papel: pendiente, con A (principal) y B (secundario), los dos con la ficha médica. */
  let N: string
  /** Un niño ya validado (`activa`) sin ninguna firma de la ficha, con A de tutor legal. */
  let O: string
  let legalA: TestUser
  let legalB: TestUser
  let direccion: TestUser
  let profe: TestUser
  const s = {} as Record<'A' | 'B' | 'dir' | 'profe', Cliente>
  const ids: string[] = []

  const firmas = (nino: string, extra = '') =>
    comoPostgres(`SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${nino}' ${extra}`)
  const matricula = async (nino: string) =>
    (await serviceClient.from('matriculas').select('estado').eq('nino_id', nino).single()).data
      ?.estado
  const presencial = (cliente: Cliente, tutor: string | null, hash: string) =>
    cliente.rpc('registrar_firma_ficha_presencial', {
      p_nino_id: N,
      p_tutor: tutor as string,
      p_hash_visto: hash,
      p_nombre_tecleado: 'Legal A Puertas',
    })

  beforeAll(async () => {
    centro = await createTestCentro('Centro Ficha Puertas')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    N = (await createTestNino(centro.id, 'Nino Ficha Puertas')).id
    O = (await createTestNino(centro.id, 'Nino Validado Puertas')).id
    await matricular(N, aula.id, curso.id)
    await matricular(O, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A Puertas' })
    legalB = await createTestUser({ nombre: 'Legal B Puertas' })
    direccion = await createTestUser({ nombre: 'Direccion Puertas' })
    profe = await createTestUser({ nombre: 'Profe Puertas' })
    ids.push(legalA.id, legalB.id, direccion.id, profe.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(legalA.id, centro.id, 'tutor_legal')
    await asignarRol(legalB.id, centro.id, 'tutor_legal')
    await crearVinculo(N, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    await crearVinculo(N, legalB.id, 'tutor_legal_secundario', { puede_ver_info_medica: true })
    await crearVinculo(O, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    const familia = (await serviceClient.from('ninos').select('familia_id').eq('id', N).single())
      .data?.familia_id
    if (!familia) throw new Error('el niño no tiene familia')
    await crearFamiliaTutor(familia, legalA.id, 'titular')
    await crearFamiliaTutor(familia, legalB.id, 'segundo_tutor')
    await completarDatosAlta(N)
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
      .eq('id', N)
    if (libro.error) throw new Error(`libro: ${libro.error.message}`)
    // En papel cierra Dirección: el acuse médico es el suyo (`marcar_matricula_lista`, U-3).
    const acuse = await serviceClient.from('consentimientos').insert({
      usuario_id: direccion.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'presencial',
      nino_id: N,
    })
    if (acuse.error) throw new Error(`acuse: ${acuse.error.message}`)
    const p = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', N)
    if (p.error) throw new Error(p.error.message)
    s.A = await clientFor(legalA)
    s.B = await clientFor(legalB)
    s.dir = await clientFor(direccion)
    s.profe = await clientFor(profe)
  }, 120_000)

  afterAll(async () => {
    if (centro) {
      comoPostgres(
        `DELETE FROM public.olvido_solicitudes WHERE centro_id = '${centro.id}' AND sujeto_tipo = 'usuario'`
      )
      await deleteTestCentro(centro.id)
    }
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  it('P0 premisa: N pendiente y O validado, sin firmas; Dirección y la profe no son nada de N', async () => {
    expect(await matricula(N)).toBe('pendiente')
    expect(await matricula(O)).toBe('activa')
    expect(firmas(N)).toBe('0')
    expect(firmas(O)).toBe('0')
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.vinculos_familiares
          WHERE nino_id = '${N}' AND usuario_id IN ('${direccion.id}', '${profe.id}') AND deleted_at IS NULL`
      )
    ).toBe('0')
    // La sesión de Dirección lee la columna nueva (el GRANT de la 10b-3), aunque aún no haya filas.
    const t = await s.dir.from('firmas_ficha').select('tutor_id').eq('nino_id', N)
    expect(t.error).toBeNull()
    expect(t.data).toEqual([])
  })

  it('la firma en papel sin decir de qué tutor es, o a nombre de quien no es tutor legal, no se registra', async () => {
    const v = await leerFichaParaFirmar(s.dir, N)
    if (!v.ok) throw new Error(`premisa: Dirección abre la ficha (${v.error})`)
    for (const [quien, tutor] of [
      ['sin tutor', null],
      ['Dirección', direccion.id],
      ['la profe', profe.id],
    ] as const) {
      const r = await presencial(s.dir, tutor, v.data.hash)
      expect.soft(r.error?.code, quien).toBe('22023')
      expect.soft(r.error?.hint, quien).toBe('no_es_tutor_legal')
    }
    expect(firmas(N)).toBe('0')
    expect(await matricula(N)).toBe('pendiente')
  })

  it('la respuesta de imagen que mira es la del tutor del papel, no la de Dirección', async () => {
    // Un «sí» a nombre de Dirección ya no entra por la función (N2): se mete como postgres, para ver
    // que la firma no se lo cuenta a nadie.
    comoPostgres(
      `INSERT INTO public.consentimientos (usuario_id, tipo, version, metodo_firma, nino_id)
       VALUES ('${direccion.id}', 'imagen', 'v1.0', 'presencial', '${N}')`
    )
    try {
      const v = await leerFichaParaFirmar(s.dir, N)
      if (!v.ok) throw new Error(v.error)
      const r = await presencial(s.dir, legalA.id, v.data.hash)
      expect(r.error?.code).toBe('P0001')
      expect(r.error?.hint).toBe('imagen_sin_respuesta')
      expect(firmas(N)).toBe('0')
    } finally {
      comoPostgres(
        `DELETE FROM public.consentimientos WHERE usuario_id = '${direccion.id}' AND nino_id = '${N}' AND tipo = 'imagen'`
      )
    }
  })

  it('en la app: a nombre de quien no es tutor legal se dice antes de llegar a la base', async () => {
    const v = await leerFichaParaFirmar(s.dir, N)
    if (!v.ok) throw new Error(v.error)
    const r = await registrarFirmaPresencialFicha(
      s.dir,
      direccion.id,
      { ninoId: N, tutorId: profe.id, hashVisto: v.data.hash, nombreTecleado: 'Profe Puertas' },
      SIN_CONTEXTO
    )
    expect(r).toEqual({ ok: false, error: 'alta.errors.tutor_papel' })
    expect(firmas(N)).toBe('0')
  })

  it('control positivo: Dirección registra la firma en papel de A, a su nombre, y cierra el alta', async () => {
    // A contesta a la imagen (su «sí», por su función): es la respuesta que mira la firma.
    const si = await s.A.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_metodo: 'checkbox',
    })
    expect(si.error).toBeNull()
    const v = await leerFichaParaFirmar(s.dir, N)
    if (!v.ok) throw new Error(v.error)
    const r = await registrarFirmaPresencialFicha(
      s.dir,
      direccion.id,
      { ninoId: N, tutorId: legalA.id, hashVisto: v.data.hash, nombreTecleado: 'Legal A Puertas' },
      SIN_CONTEXTO
    )
    expect(r.ok).toBe(true)
    expect(await matricula(N)).toBe('lista')
    const fila = await s.dir
      .from('firmas_ficha')
      .select('firmante_id, tutor_id, metodo_firma, rol_firmante')
      .eq('nino_id', N)
    expect(fila.data).toEqual([
      {
        firmante_id: direccion.id,
        tutor_id: legalA.id,
        metodo_firma: 'presencial',
        rol_firmante: 'admin',
      },
    ])
  })

  it('A olvidado con N vivo: la tabla le oculta la firma del papel y la vista de bloqueados la enseña', async () => {
    // Premisa: antes del olvido, Dirección la ve.
    const antes = await s.dir.from('firmas_ficha').select('id').eq('nino_id', N)
    expect(antes.data).toHaveLength(1)
    const firmaId = antes.data![0]!.id
    comoPostgres(
      `INSERT INTO public.olvido_solicitudes (sujeto_tipo, sujeto_id, centro_id, estado, confirmada_en, gracia_hasta, purgado_en)
       VALUES ('usuario', '${legalA.id}', '${centro.id}', 'confirmada', now(), now(), now())`
    )
    try {
      // La firma la registró Dirección, que no está olvidada: la oculta el tutor (`tutor_id`).
      const despues = await s.dir.from('firmas_ficha').select('id').eq('nino_id', N)
      expect(despues.error).toBeNull()
      expect(despues.data).toEqual([])
      expect(firmas(N)).toBe('1')
      expect(
        comoPostgres(
          `SELECT (privado.datos_bloqueados('usuario', '${legalA.id}', true)::text LIKE '%firmas_ficha%')::text`
        )
      ).toBe('true')
      const contenido = comoPostgres(
        `SELECT privado.contenido_bloqueado('${centro.id}', 'usuario', '${legalA.id}')::text`
      )
      expect(contenido).toContain(firmaId)
      // Sin la foto: la foto es de la 10c.
      expect(contenido).not.toContain('contenido_cifrado')
    } finally {
      comoPostgres(
        `DELETE FROM public.olvido_solicitudes WHERE sujeto_id = '${legalA.id}' AND centro_id = '${centro.id}'`
      )
    }
    expect((await s.dir.from('firmas_ficha').select('id').eq('nino_id', N)).data).toHaveLength(1)
  })

  it('un alta validada sin firma: sin pedirla no firma nadie; Dirección la pide y A firma por la función', async () => {
    const v = await leerFichaParaFirmar(s.A, O)
    if (!v.ok) throw new Error(v.error)
    const firmar = () =>
      s.A.rpc('firmar_ficha', {
        p_nino_id: O,
        p_hash_visto: v.data.hash,
        p_nombre_tecleado: 'Legal A Puertas',
        p_firma_imagen: TRAZO,
      })
    // No se le obliga: sin petición, nada que firmar (la regla de no obligar se queda).
    const sinPedir = await firmar()
    expect(sinPedir.error?.hint).toBe('nada_que_firmar')
    expect(firmas(O)).toBe('0')
    // Antes de la 10b-3, `sin_firma`. Ahora la pide la directora, que es quien lo decide.
    const pedir = await s.dir.rpc('pedir_refirma_ficha', { p_nino_id: O })
    expect(pedir.error).toBeNull()
    const r = await firmar()
    expect(r.error).toBeNull()
    expect(firmas(O)).toBe('1')
    expect(await matricula(O)).toBe('activa')
  })

  it('la oposición, al tutor que no ha contestado: la distingue de «nadie ha dicho que sí»', async () => {
    const oposicion = async (c: Cliente) => c.rpc('oposicion_imagen', { p_nino_id: N })
    // Premisa: A dijo «sí» (arriba) y B no ha contestado.
    expect((await oposicion(s.B)).data).toBe(false)
    const no = await s.A.rpc('denegar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_version: 'v1.0',
    })
    expect(no.error).toBeNull()
    // B, que no ha contestado, ya sabe que hay una oposición (sin saber de quién).
    expect((await oposicion(s.B)).data).toBe(true)
    // A no cuenta su propio «no»; Dirección sí lo ve; la profe no pregunta.
    expect((await oposicion(s.A)).data).toBe(false)
    expect((await oposicion(s.dir)).data).toBe(true)
    expect((await oposicion(s.profe)).error?.code).toBe('42501')
  })
})
