import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import { borrarMandatos } from './mandatos-como-postgres'
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
  datosMandatoV2,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'
import { firmarV3 } from './mandato-v3-de-test'

type Cliente = SupabaseClient<Database>

/**
 * Después de validar, lo que es prueba no cambia sin Dirección (`20270201120000`). Spec
 * `docs/specs/altas-serie.md`, «Después de validar, nada cambia sin validación» (2026-11-20, regla de
 * Jose, opción A). Medido abierto en producción el 2026-11-20: la tutora SOBRESCRIBÍA el DNI, el libro,
 * el PDF del mandato, la tarjeta y el justificante ya validados, en su misma ruta, sin dejar rastro.
 *
 * Los ficheros se suben DE VERDAD por la API de Storage, con la sesión de la tutora (decisión del
 * 2026-11-20: la prueba de Storage, en la base efímera del CI, nunca en producción). El control
 * positivo va primero: con el alta sin validar, la misma subida sobrescribe; si después falla, es por
 * la validación y no por el instrumento.
 *
 * Cada `it` parte del estado que deja el anterior.
 */
describe('después de validar, lo que es prueba no cambia sin Dirección', () => {
  let centro: TestCentro
  let N: string
  let F: string
  let mat: string
  let tutora: TestUser
  let direccion: TestUser
  const s = {} as Record<'T' | 'D', Cliente>
  const ids: string[] = []
  let activoInicial = ''

  // Un PDF distinto por versión: el bucket mira el contentType declarado, y el contenido dice cuál quedó.
  const pdf = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n`)
  const IBAN_1 = 'ES7620770024003102575766'
  const IBAN_2 = 'ES9121000418450200051332'

  /**
   * Los ficheros que son prueba y se cambian por la cola. El PDF del mandato ya no está: desde
   * 20270204120000 no lo sobrescribe ni lo borra nadie, ni antes ni después de validar (decisión 1
   * del cierre del mandato, 2026-11-22, que sustituye aquí a la de #541); lo mide
   * `mandato-prueba-inmutable.rls.test.ts`.
   */
  const ficheros = () => [
    {
      nombre: 'dni',
      bucket: 'dni-tutores',
      ruta: `${centro.id}/${N}/dni-tutor_legal_principal-${randomUUID()}.pdf`,
    },
    { nombre: 'libro', bucket: 'libro-familia', ruta: `${centro.id}/${N}/${randomUUID()}.pdf` },
    { nombre: 'tarjeta', bucket: 'sip-ninos', ruta: `${centro.id}/${N}/${randomUUID()}.pdf` },
    {
      nombre: 'justificante',
      bucket: 'justificantes-gestion',
      ruta: `${centro.id}/${N}/${randomUUID()}.pdf`,
    },
  ]
  let F6: ReturnType<typeof ficheros> = []

  const subir = (c: Cliente, bucket: string, ruta: string, marca: string, upsert: boolean) =>
    c.storage.from(bucket).upload(ruta, pdf(marca), { contentType: 'application/pdf', upsert })
  /** Lo que hay guardado, leído como servicio (no depende de la RLS que se mide). */
  const contenido = async (bucket: string, ruta: string) => {
    const { data, error } = await serviceClient.storage.from(bucket).download(ruta)
    if (error || !data) return `ERROR ${error?.message ?? 'sin datos'}`
    return (await data.text()).split('\n')[1]
  }

  const argsMandato = (iban: string, documento: string) =>
    ({
      p_familia_id: F,
      p_nino_id: null,
      p_iban: iban,
      p_titular: 'Tutora Prueba',
      p_identificador_mandato: `NIDO-PRUEBA-${randomUUID()}`,
      p_documento_path: documento,
      p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
      p_nombre_tecleado: 'Tutora Prueba',
      p_texto_hash: 'a'.repeat(64),
      ...datosMandatoV2(centro),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-11-20T10:00:00Z',
      p_metodo: 'digital',
    }) as never
  const mandatos = () =>
    comoPostgres(
      `SELECT string_agg(estado::text, ',' ORDER BY created_at, id) FROM public.mandatos_sepa WHERE familia_id = '${F}'`
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro Prueba Tras Validar')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    const nino = await createTestNino(centro.id, 'Nino Prueba Tras Validar')
    N = nino.id
    F = nino.familia_id
    mat = await matricular(N, aula.id, curso.id)
    tutora = await createTestUser({ nombre: 'Tutora Prueba' })
    direccion = await createTestUser({ nombre: 'Direccion Prueba' })
    ids.push(tutora.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(F, tutora.id, 'titular')
    await crearVinculo(N, tutora.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    await completarDatosAlta(N)
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
      .eq('id', N)
    if (libro.error) throw new Error(`libro: ${libro.error.message}`)
    const acuse = await serviceClient.from('consentimientos').insert({
      usuario_id: tutora.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
      nino_id: N,
    })
    if (acuse.error) throw new Error(`acuse: ${acuse.error.message}`)
    const p = await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('id', mat)
    if (p.error) throw new Error(p.error.message)
    s.T = await clientFor(tutora)
    s.D = await clientFor(direccion)

    // El alta, hasta la firma de la ficha: la tutora la firma y el alta queda en `lista` (sin validar).
    const med = await s.D.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: N,
      p_alergias_graves: 'Cacahuete Demo',
      p_notas_emergencia: '',
      p_medicacion_habitual: '',
      p_alergias_leves: '',
      p_medico_familia: '',
      p_telefono_emergencia: '',
    })
    if (med.error) throw new Error(`médica: ${med.error.message}`)
    const o = await s.T.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: tutora.id,
      p_version: 'v1.0',
      p_metodo: 'checkbox',
    })
    if (o.error) throw new Error(`imagen: ${o.error.message}`)
    const v = await s.T.rpc('ficha_para_firmar', { p_nino_id: N })
    if (v.error) throw new Error(`ver: ${v.error.message}`)
    const f = await s.T.rpc('firmar_ficha', {
      p_nino_id: N,
      p_hash_visto: (v.data as { hash: string }).hash,
      p_nombre_tecleado: 'Tutora Prueba',
      p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
    })
    if (f.error) throw new Error(`firmar: ${f.error.message}`)
    F6 = ficheros()
  }, 120_000)

  afterAll(async () => {
    if (centro) {
      for (const b of [
        'dni-tutores',
        'libro-familia',
        'mandato-sepa',
        'sip-ninos',
        'justificantes-gestion',
      ]) {
        const nombres = comoPostgres(
          `SELECT coalesce(string_agg(name, E'\\n'), '') FROM storage.objects WHERE bucket_id = '${b}' AND name LIKE '${centro.id}/%'`
        )
        if (nombres) await serviceClient.storage.from(b).remove(nombres.split('\n'))
      }
      borrarMandatos('centro_id', centro.id)
      await deleteTestCentro(centro.id)
    }
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  // ─── Antes de validar: el control positivo ───────────────────────────────────────────────────

  it('P0: el alta está firmada y sin validar (lista); la familia, sin validar', () => {
    expect(comoPostgres(`SELECT estado FROM public.matriculas WHERE id = '${mat}'`)).toBe('lista')
    expect(comoPostgres(`SELECT privado.familia_alta_validada('${F}')::text`)).toBe('false')
  })

  it('C+: sin validar, la tutora sube cada fichero y lo SOBRESCRIBE por la API', async () => {
    for (const x of F6) {
      expect
        .soft((await subir(s.T, x.bucket, x.ruta, 'v1', false)).error, `${x.nombre} v1`)
        .toBeNull()
      expect
        .soft((await subir(s.T, x.bucket, x.ruta, 'v2', true)).error, `${x.nombre} v2`)
        .toBeNull()
      expect.soft(await contenido(x.bucket, x.ruta), x.nombre).toBe('% v2')
    }
  })

  it('C+: sin validar, el mandato del tutor se registra directo; y no se puede proponer', async () => {
    const r = await firmarV3(
      s.T,
      'registrar_mandato_sepa',
      argsMandato(IBAN_1, `${centro.id}/familia/${F}/mandato-inicial.pdf`)
    )
    expect(r.error).toBeNull()
    activoInicial = r.data as string
    expect(mandatos()).toBe('activo')
    const p = await firmarV3(
      s.T,
      'proponer_mandato_sepa',
      argsMandato(IBAN_2, `${centro.id}/familia/${F}/mandato-x.pdf`)
    )
    expect(p.error?.hint).toBe('sin_validar')
  })

  // ─── Se valida ───────────────────────────────────────────────────────────────────────────────

  it('Dirección valida el alta (validar_alta): la familia y cada ruta quedan validadas', async () => {
    const r = await s.D.rpc('validar_alta', {
      p_matricula_id: mat,
      p_fecha_incorporacion: '2026-09-01',
    })
    expect(r.error).toBeNull()
    expect(comoPostgres(`SELECT privado.familia_alta_validada('${F}')::text`)).toBe('true')
    for (const x of F6)
      expect
        .soft(
          comoPostgres(`SELECT privado.alta_validada_de_ruta('${x.bucket}', '${x.ruta}')::text`),
          x.nombre
        )
        .toBe('true')
  })

  it('14 · recién validada, la ficha firmada vale: no sale en la lista de Dirección', async () => {
    const r = await s.D.rpc('fichas_firmadas_sin_validez', { p_centro_id: centro.id })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([])
  })

  // ─── 1 a 5 · los ficheros ────────────────────────────────────────────────────────────────────

  it('1-5 · validada, la tutora NO sobrescribe ninguno (upsert por la API) y el contenido no cambia', async () => {
    for (const x of F6) {
      const r = await subir(s.T, x.bucket, x.ruta, 'v3', true)
      expect.soft(r.error?.message, x.nombre).toMatch(/row-level security/i)
      expect.soft(await contenido(x.bucket, x.ruta), x.nombre).toBe('% v2')
    }
  })

  it('1-5 · ni por update() de la API', async () => {
    for (const x of F6) {
      const r = await s.T.storage
        .from(x.bucket)
        .update(x.ruta, pdf('v3'), { contentType: 'application/pdf' })
      expect.soft(r.error, x.nombre).not.toBeNull()
      expect.soft(await contenido(x.bucket, x.ruta), x.nombre).toBe('% v2')
    }
  })

  it('1-5 · ni borrándolo', async () => {
    for (const x of F6) {
      await s.T.storage.from(x.bucket).remove([x.ruta])
      expect.soft(await contenido(x.bucket, x.ruta), x.nombre).toBe('% v2')
    }
  })

  it('1-5 · pero sube uno NUEVO a otra ruta: así propone el cambio a la cola', async () => {
    for (const x of F6) {
      const nueva = x.ruta.replace(/[^/]+\.pdf$/, `nuevo-${randomUUID()}.pdf`)
      expect.soft((await subir(s.T, x.bucket, nueva, 'n1', false)).error, x.nombre).toBeNull()
    }
  })

  it('1-5 · Dirección sí sobrescribe (es quien valida)', async () => {
    for (const x of F6) {
      expect.soft((await subir(s.D, x.bucket, x.ruta, 'v4', true)).error, x.nombre).toBeNull()
      expect.soft(await contenido(x.bucket, x.ruta), x.nombre).toBe('% v4')
    }
  })

  // ─── 8 · el mandato ──────────────────────────────────────────────────────────────────────────

  it('8 · validada, la tutora no registra ni sustituye: cola_validacion', async () => {
    const r = await firmarV3(
      s.T,
      'registrar_mandato_sepa',
      argsMandato(IBAN_1, `${centro.id}/familia/${F}/mandato-r.pdf`)
    )
    expect(r.error?.code).toBe('42501')
    expect(r.error?.hint).toBe('cola_validacion')
    const u = await firmarV3(
      s.T,
      'sustituir_mandato_sepa',
      argsMandato(IBAN_2, `${centro.id}/familia/${F}/mandato-s.pdf`)
    )
    expect(u.error?.hint).toBe('cola_validacion')
    expect(mandatos()).toBe('activo')
  })

  let propuesto = ''
  it('8 · propone: el mandato queda propuesto y su entrada, en la cola de Dirección', async () => {
    const r = await firmarV3(
      s.T,
      'proponer_mandato_sepa',
      argsMandato(IBAN_2, `${centro.id}/familia/${F}/mandato-p.pdf`)
    )
    expect(r.error).toBeNull()
    propuesto = r.data as string
    expect(mandatos()).toBe('activo,propuesto')
    expect(
      comoPostgres(
        `SELECT estado || '|' || (payload->>'mandato_id') FROM public.cambios_pendientes WHERE entidad = 'mandato_sepa' AND registro_id = '${propuesto}'`
      )
    ).toBe(`pendiente|${propuesto}`)
    // El IBAN no viaja en la cola: cifrado en la fila del mandato, con sus cuatro últimas cifras.
    expect(
      comoPostgres(`SELECT iban_ultimos4 FROM public.mandatos_sepa WHERE id = '${propuesto}'`)
    ).toBe('1332')
  })

  it('8 · una segunda propuesta espera a que se resuelva la primera', async () => {
    const r = await firmarV3(
      s.T,
      'proponer_mandato_sepa',
      argsMandato(IBAN_1, `${centro.id}/familia/${F}/mandato-q.pdf`)
    )
    expect(r.error?.hint).toBe('mandato_pendiente')
  })

  it('8 · la tutora no decide su propia propuesta', async () => {
    const r = await s.T.rpc('decidir_mandato_propuesto', {
      p_mandato_id: propuesto,
      p_aprobar: true,
    })
    expect(r.error?.code).toBe('42501')
    expect(mandatos()).toBe('activo,propuesto')
  })

  it('8 · Dirección aprueba: el propuesto pasa a activo, el de antes a revocado, la entrada a aprobada', async () => {
    const r = await s.D.rpc('decidir_mandato_propuesto', {
      p_mandato_id: propuesto,
      p_aprobar: true,
    })
    expect(r.error).toBeNull()
    expect(
      comoPostgres(`SELECT estado FROM public.mandatos_sepa WHERE id = '${activoInicial}'`)
    ).toBe('revocado')
    expect(comoPostgres(`SELECT estado FROM public.mandatos_sepa WHERE id = '${propuesto}'`)).toBe(
      'activo'
    )
    expect(
      comoPostgres(
        `SELECT estado FROM public.cambios_pendientes WHERE registro_id = '${propuesto}'`
      )
    ).toBe('aprobado')
  })

  // B2 (2026-11-27, medido antes de construir): ¿reaplicar el mandato es inofensivo? El test de arriba ya mide
  // que la base decide el mandato Y marca la entrada de la cola en la MISMA llamada (la entrada estaba
  // 'pendiente' y sale 'aprobado'): aplicado y sin marcar no puede pasar. Esto mide la segunda vez.
  it('B2 · reaplicar el mandato ya aprobado: la base dice no_propuesto y no cambia nada', async () => {
    const estados = () =>
      comoPostgres(
        `SELECT string_agg(estado::text, ',' ORDER BY created_at, id) FROM public.mandatos_sepa WHERE familia_id = '${F}'`
      )
    const antes = estados()
    const r = await s.D.rpc('decidir_mandato_propuesto', {
      p_mandato_id: propuesto,
      p_aprobar: true,
    })
    expect(r.error?.hint).toBe('no_propuesto')
    expect(estados()).toBe(antes)
    expect(
      comoPostgres(
        `SELECT estado FROM public.cambios_pendientes WHERE registro_id = '${propuesto}'`
      )
    ).toBe('aprobado')
  })

  it('8 · otra propuesta, y Dirección la rechaza: queda rechazada y el activo sigue', async () => {
    const r = await firmarV3(
      s.T,
      'proponer_mandato_sepa',
      argsMandato(IBAN_1, `${centro.id}/familia/${F}/mandato-t.pdf`)
    )
    expect(r.error).toBeNull()
    const d = await s.D.rpc('decidir_mandato_propuesto', {
      p_mandato_id: r.data as string,
      p_aprobar: false,
    })
    expect(d.error).toBeNull()
    expect(mandatos()).toBe('revocado,activo,rechazado')
    const otra = await s.D.rpc('decidir_mandato_propuesto', {
      p_mandato_id: r.data as string,
      p_aprobar: true,
    })
    expect(otra.error?.hint).toBe('no_propuesto')
  })

  // ─── 14 · la ficha que deja de valer ─────────────────────────────────────────────────────────

  it('14 · la información médica sigue libre: la tutora la cambia directa, con el alta validada', async () => {
    const r = await s.T.rpc('set_info_medica_emergencia_cifrada_tutor', {
      p_nino_id: N,
      p_alergias_graves: 'Frutos secos',
      p_notas_emergencia: '',
      p_medicacion_habitual: '',
      p_alergias_leves: '',
      p_medico_familia: '',
      p_telefono_emergencia: '',
      p_reemplazar: true,
    })
    expect(r.error).toBeNull()
  })

  it('14 · y la ficha firmada, que ya no vale, sale en la lista de Dirección', async () => {
    const r = await s.D.rpc('fichas_firmadas_sin_validez', { p_centro_id: centro.id })
    expect(r.error).toBeNull()
    expect((r.data ?? []).map((f) => `${f.nino_id}|${f.refirma_pedida}`)).toEqual([`${N}|false`])
  })

  it('14 · pedida la refirma, sigue en la lista, marcada', async () => {
    const p = await s.D.rpc('pedir_refirma_ficha', { p_nino_id: N })
    expect(p.error).toBeNull()
    const r = await s.D.rpc('fichas_firmadas_sin_validez', { p_centro_id: centro.id })
    expect((r.data ?? []).map((f) => `${f.nino_id}|${f.refirma_pedida}`)).toEqual([`${N}|true`])
  })

  it('14 · la tutora no lee la lista de Dirección', async () => {
    const r = await s.T.rpc('fichas_firmadas_sin_validez', { p_centro_id: centro.id })
    expect(r.error?.code).toBe('42501')
  })

  // ─── la autobaja ─────────────────────────────────────────────────────────────────────────────

  it('C+: la tutora cambia su idioma (lo que la app escribe)', async () => {
    const r = await s.T.from('usuarios')
      .update({ idioma_preferido: 'va' })
      .eq('id', tutora.id)
      .select('id')
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
  })

  it('la tutora NO se marca como borrada, ni declara una versión de privacidad, ni cambia su nombre', async () => {
    for (const cambio of [
      { deleted_at: new Date().toISOString() },
      { consentimiento_privacidad_version: 'v9.9' },
      { consentimiento_terminos_version: 'v9.9' },
      { nombre_completo: 'Otro Nombre' },
    ]) {
      const r = await s.T.from('usuarios').update(cambio).eq('id', tutora.id)
      expect.soft(r.error?.code, Object.keys(cambio)[0]).toBe('42501')
    }
    expect(
      comoPostgres(
        `SELECT (deleted_at IS NULL)::text || '|' || coalesce(consentimiento_privacidad_version, '-') || '|' || nombre_completo FROM public.usuarios WHERE id = '${tutora.id}'`
      )
    ).toBe('true|-|Tutora Prueba')
  })
})
