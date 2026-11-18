import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
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

/**
 * El «no» de la imagen (fase 10, 10a-2, `20270127120000`). Decisión del responsable del 2026-11-17:
 * «CADA TUTOR RESPONDE POR SÍ, Y SI HAY ALGÚN «NO» VIGENTE, NO HAY CONSENTIMIENTO. Un «no» solo lo
 * retira quien lo puso, o Dirección con su rastro; el «sí» del otro tutor no lo tumba.»
 *
 * Medido ABIERTO en producción el mismo día: con el «no» de B, el «sí» de A (otorgado o firmado)
 * dejaba al niño autorizado en las siete puertas. Aquí, cerradas, y los controles de que el «sí»
 * sigue valiendo sin el «no».
 */
describe('el «no» de la imagen: cada tutor responde por sí', () => {
  let centro: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let legalA: TestUser
  let legalB: TestUser
  let autorizado: TestUser
  let direccion: TestUser
  const usuarios: string[] = []
  const sesiones = new Map<string, SupabaseClient<Database>>()
  const como = async (u: TestUser) => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  const PUB = 'e0000000-0000-4000-8000-0000000000a1'
  const MEDIA = 'e0000000-0000-4000-8000-0000000000a2'
  const PLANTILLA = 'e0000000-0000-4000-8000-0000000000a3'
  const INSTANCIA = 'e0000000-0000-4000-8000-0000000000a4'

  const otorgar = async (u: TestUser) =>
    (await como(u)).rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: u.id,
      p_version: 'v1.0',
      p_metodo: 'checkbox',
    })
  const denegar = async (
    u: TestUser,
    tutor: TestUser = u,
    metodo: 'checkbox' | 'presencial' = 'checkbox'
  ) =>
    (await como(u)).rpc('denegar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: tutor.id,
      p_version: 'v1.0',
      p_metodo: metodo,
    })
  const retirar = async (u: TestUser, tutor: TestUser) =>
    (await como(u)).rpc('retirar_denegacion_imagen', { p_nino_id: nino.id, p_tutor: tutor.id })
  const existe = async (u: TestUser) =>
    (await como(u)).rpc('existe_consentimiento_imagen', { p_nino_id: nino.id })

  /** Las cinco lecturas que deciden «autorizado», de una vez (cada una en su sentencia). */
  const lecturas = async () => {
    const ea = await existe(legalA)
    const eb = await existe(legalB)
    const base = comoPostgres(
      `SELECT public.tiene_consentimiento_imagen('${nino.id}')::text || '|' ||
              (SELECT puede_aparecer_en_fotos::text FROM public.ninos WHERE id = '${nino.id}') || '|' ||
              privado.nino_puede_aparecer('${nino.id}')::text`
    )
    const oculta = comoPostgres(`SELECT public.publicacion_tiene_nino_sin_permiso('${PUB}')::text`)
    return `${String(ea.data)}|${String(eb.data)}|${base}|oculta=${oculta}`
  }
  const NINGUNA = 'false|false|false|false|false|oculta=true'
  const TODAS = 'true|true|true|true|true|oculta=false'

  const vigentes = (tipo: 'imagen' | 'imagen_denegada', u: TestUser) =>
    comoPostgres(
      `SELECT count(*) FROM public.consentimientos WHERE nino_id = '${nino.id}'
         AND usuario_id = '${u.id}' AND tipo = '${tipo}' AND revocado_en IS NULL`
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro No Imagen')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino No Imagen')
    await matricular(nino.id, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A No Imagen' })
    legalB = await createTestUser({ nombre: 'Legal B No Imagen' })
    autorizado = await createTestUser({ nombre: 'Autorizado No Imagen' })
    direccion = await createTestUser({ nombre: 'Direccion No Imagen' })
    usuarios.push(legalA.id, legalB.id, autorizado.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(legalA.id, centro.id, 'tutor_legal')
    await asignarRol(legalB.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearVinculo(nino.id, legalA.id, 'tutor_legal_principal', {
      // firmas_insert lo exige para firmar la autorización de imagen (caso de firma_imagen_sync).
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(nino.id, legalB.id, 'tutor_legal_secundario', {})
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    // Una publicación del aula con el niño etiquetado (como el servicio: el etiquetado lo deja la
    // política solo con el niño autorizado, y aquí se mide si se oculta).
    const p = await serviceClient.from('publicaciones').insert({
      id: PUB,
      centro_id: centro.id,
      aula_id: aula.id,
      autor_id: direccion.id,
      texto: 'x',
    })
    if (p.error) throw new Error(`publicación: ${p.error.message}`)
    const m = await serviceClient.from('media').insert({
      id: MEDIA,
      publicacion_id: PUB,
      centro_id: centro.id,
      bucket: 'aula-fotos',
      path: `${centro.id}/${aula.id}/${PUB}/ensayo.jpg`,
      mime: 'image/jpeg',
    })
    if (m.error) throw new Error(`media: ${m.error.message}`)
    const e = await serviceClient
      .from('media_etiquetas')
      .insert({ media_id: MEDIA, nino_id: nino.id, centro_id: centro.id })
    if (e.error) throw new Error(`etiqueta: ${e.error.message}`)

    // La autorización de imagen del niño, publicada (para firmarla).
    const comun = {
      centro_id: centro.id,
      tipo: 'autorizacion_imagenes' as const,
      titulo: 'Imagen',
      texto: 'Texto de imagen',
      texto_version: 'v1.0',
      texto_definitivo: true,
      estado: 'publicada' as const,
      creado_por: direccion.id,
    }
    const pl = await serviceClient
      .from('autorizaciones')
      .insert({ ...comun, id: PLANTILLA, es_plantilla: true })
    if (pl.error) throw new Error(`plantilla: ${pl.error.message}`)
    const ins = await serviceClient.from('autorizaciones').insert({
      ...comun,
      id: INSTANCIA,
      es_plantilla: false,
      plantilla_id: PLANTILLA,
      ambito: 'nino',
      nino_id: nino.id,
    })
    if (ins.error) throw new Error(`instancia: ${ins.error.message}`)
  }, 240_000)

  beforeEach(async () => {
    // Cada caso parte sin respuestas: el trigger recalcula el indicador al borrar.
    comoPostgres(
      `DELETE FROM public.firmas_autorizacion WHERE nino_id = '${nino.id}';
       DELETE FROM public.consentimientos WHERE nino_id = '${nino.id}';`
    )
  })

  afterAll(async () => {
    comoPostgres(
      `DELETE FROM public.firmas_autorizacion WHERE nino_id = '${nino.id}';
       DELETE FROM public.consentimientos WHERE nino_id = '${nino.id}';
       DELETE FROM public.audit_log WHERE tabla = 'imagen_no_retirado' AND centro_id = '${centro.id}';
       DELETE FROM public.autorizaciones WHERE id IN ('${INSTANCIA}', '${PLANTILLA}');
       DELETE FROM public.media_etiquetas WHERE media_id = '${MEDIA}';
       DELETE FROM public.media WHERE id = '${MEDIA}';
       DELETE FROM public.publicaciones WHERE id = '${PUB}';`
    )
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('premisas: A y B tutores legales, el autorizado no, y sin respuestas nada autoriza', async () => {
    const tipos = comoPostgres(
      `SELECT string_agg(left(usuario_id::text, 8) || ':' || tipo_vinculo, ',' ORDER BY tipo_vinculo)
         FROM public.vinculos_familiares WHERE nino_id = '${nino.id}' AND deleted_at IS NULL`
    )
    expect(tipos).toBe(
      [
        `${legalA.id.slice(0, 8)}:tutor_legal_principal`,
        `${legalB.id.slice(0, 8)}:tutor_legal_secundario`,
        `${autorizado.id.slice(0, 8)}:autorizado`,
      ].join(',')
    )
    expect(await lecturas()).toBe(NINGUNA)
  })

  it('control: el «sí» de A solo autoriza en las cinco lecturas y la publicación se ve', async () => {
    expect((await otorgar(legalA)).error).toBeNull()
    expect(await lecturas()).toBe(TODAS)
  })

  it('el «no» de B pesa contra el «sí» de A que llega después (otorgar)', async () => {
    expect((await denegar(legalB)).error).toBeNull()
    expect((await otorgar(legalA)).error).toBeNull()
    expect(vigentes('imagen', legalA)).toBe('1')
    expect(await lecturas()).toBe(NINGUNA)
    expect(vigentes('imagen_denegada', legalB)).toBe('1')
  })

  it('el «no» de B pesa contra el «sí» que A ya había dado: el indicador cae al llegar el «no»', async () => {
    expect((await otorgar(legalA)).error).toBeNull()
    expect(await lecturas()).toBe(TODAS)
    expect((await denegar(legalB)).error).toBeNull()
    expect(await lecturas()).toBe(NINGUNA)
    expect(vigentes('imagen', legalA)).toBe('1')
  })

  it('el «no» de B pesa contra la autorización de imagen que firma A (firma_imagen_sync)', async () => {
    expect((await denegar(legalB)).error).toBeNull()
    const f = await (await como(legalA)).from('firmas_autorizacion').insert({
      autorizacion_id: INSTANCIA,
      nino_id: nino.id,
      firmante_id: legalA.id,
      rol_firmante: 'tutor_legal_principal',
      decision: 'firmado',
      texto_hash: 'cd'.repeat(32),
      texto_version: 'v1.0',
      nombre_tecleado: 'Legal A',
      firma_imagen: 'data:image/png;base64,RU5TQVlP',
      metodo_firma: 'digital',
    })
    expect(f.error).toBeNull()
    expect(vigentes('imagen', legalA)).toBe('1')
    expect(await lecturas()).toBe(NINGUNA)
  })

  it('registrar_consentimiento no registra un «no», tampoco el servicio (22023, imagen)', async () => {
    const { error } = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: legalB.id,
      p_tipo: 'imagen_denegada',
      p_version: 'v1.0',
      p_metodo: 'checkbox',
      p_nino_id: nino.id,
    })
    expect(error?.code).toBe('22023')
    expect(error?.hint).toBe('imagen')
    expect(vigentes('imagen_denegada', legalB)).toBe('0')
  })

  it('un «no» vigente por tutor: repetirlo devuelve el mismo, y la base no deja otro', async () => {
    const a = await denegar(legalB)
    const b = await denegar(legalB)
    expect(a.error).toBeNull()
    expect(b.data).toBe(a.data)
    expect(vigentes('imagen_denegada', legalB)).toBe('1')
    const otra = await serviceClient.from('consentimientos').insert({
      usuario_id: legalB.id,
      tipo: 'imagen_denegada',
      version: 'v1.0',
      nino_id: nino.id,
      metodo_firma: 'checkbox',
    })
    expect(otra.error?.code).toBe('23505')
  })

  it('el «no» de B no lo retira A (42501); lo retira B, y el «sí» de A vuelve a valer', async () => {
    expect((await otorgar(legalA)).error).toBeNull()
    expect((await denegar(legalB)).error).toBeNull()
    const deA = await retirar(legalA, legalB)
    expect(deA.error?.code).toBe('42501')
    expect(vigentes('imagen_denegada', legalB)).toBe('1')
    const deB = await retirar(legalB, legalB)
    expect(deB.error).toBeNull()
    expect(deB.data).toBe(1)
    expect(await lecturas()).toBe(TODAS)
    // Lo retiró quien lo puso: sin rastro de «otro».
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.audit_log WHERE tabla = 'imagen_no_retirado' AND centro_id = '${centro.id}'`
      )
    ).toBe('0')
  })

  it('Dirección retira el «no» de B y deja su rastro en audit_log', async () => {
    const no = await denegar(legalB)
    expect(no.error).toBeNull()
    const r = await retirar(direccion, legalB)
    expect(r.error).toBeNull()
    expect(r.data).toBe(1)
    expect(
      comoPostgres(
        `SELECT usuario_id || '|' || (valores_despues->>'accion') FROM public.audit_log
          WHERE tabla = 'imagen_no_retirado' AND registro_id = '${no.data}'`
      )
    ).toBe(`${direccion.id}|retirado_por_otro`)
  })

  it('cada tutor responde por sí: el «sí» de B retira su «no», y su «no» retira su «sí»; el de A no se toca', async () => {
    expect((await otorgar(legalA)).error).toBeNull()
    expect((await denegar(legalB)).error).toBeNull()
    expect((await otorgar(legalB)).error).toBeNull()
    expect(vigentes('imagen_denegada', legalB)).toBe('0')
    expect(await lecturas()).toBe(TODAS)
    expect((await denegar(legalB)).error).toBeNull()
    expect(vigentes('imagen', legalB)).toBe('0')
    expect(vigentes('imagen', legalA)).toBe('1')
    expect(await lecturas()).toBe(NINGUNA)
  })

  it('revocar no cambia: retira los «sí» de todos y deja el «no»', async () => {
    expect((await otorgar(legalA)).error).toBeNull()
    expect((await denegar(legalB)).error).toBeNull()
    const r = await (
      await como(legalA)
    ).rpc('revocar_consentimiento_imagen', { p_nino_id: nino.id })
    expect(r.error).toBeNull()
    expect(vigentes('imagen', legalA)).toBe('0')
    expect(vigentes('imagen_denegada', legalB)).toBe('1')
  })

  it('quién puede decir «no»: Dirección en persona por B sí; por sí misma no (no es tutora); el autorizado no', async () => {
    const porB = await denegar(direccion, legalB, 'presencial')
    expect(porB.error).toBeNull()
    expect(vigentes('imagen_denegada', legalB)).toBe('1')
    const ella = await denegar(direccion, direccion, 'presencial')
    expect(ella.error?.code).toBe('22023')
    expect(ella.error?.hint).toBe('no_es_tutor_legal')
    const aut = await denegar(autorizado)
    expect(aut.error?.code).toBe('42501')
    expect(vigentes('imagen_denegada', autorizado)).toBe('0')
  })

  it('una sola consulta: tiene_consentimiento_imagen es una sentencia SQL', () => {
    expect(
      comoPostgres(
        `SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = 'public.tiene_consentimiento_imagen(uuid)'::regprocedure`
      )
    ).toBe('sql')
  })
})
