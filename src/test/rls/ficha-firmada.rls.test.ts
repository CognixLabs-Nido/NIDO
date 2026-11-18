import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import { BUCKET_JUSTIFICANTES_GESTION } from '@/shared/lib/adjuntos/storage'
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
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

type Cliente = SupabaseClient<Database>

/**
 * Fase 10b-1 — la ficha firmada en la base (`20270128120000`; spec `docs/specs/altas-serie.md`,
 * «10b: el diseño», «Las dos, resueltas» y «La imagen, fuera del hash»). Decidido por el responsable
 * del 2026-11-16 al 18: la foto cifrada de todo lo declarado con su hash; basta un tutor; FIRMAR ES
 * FINALIZAR; un cambio entre firmar y validar INVALIDA la firma; la firma es inmutable y Dirección
 * pide refirma; en papel, Dirección registra la presencial sin trazo; firma solo el tutor legal que
 * puede ver la ficha médica; la imagen va en la foto y fuera del sello; se purga con el niño.
 *
 * Es el espejo del ensayo de producción del 2026-11-18 (B1–B14 y B7b, terminado en RAISE), en el
 * mismo orden: cada `it` parte del estado que deja el anterior.
 */
describe('la ficha firmada (fase 10b-1)', () => {
  let centro: { id: string }
  let N: string
  let legalA: TestUser
  let legalB: TestUser
  let autorizado: TestUser
  let direccion: TestUser
  let vinculoB: string
  const s = {} as Record<'A' | 'B' | 'aut' | 'dir', Cliente>
  const ids: string[] = []

  const ver = async (c: Cliente) => {
    const r = await c.rpc('ficha_para_firmar', { p_nino_id: N })
    return { error: r.error, hash: (r.data as { hash?: string } | null)?.hash ?? null }
  }
  const firmar = (c: Cliente, hash: string) =>
    c.rpc('firmar_ficha', {
      p_nino_id: N,
      p_hash_visto: hash,
      p_nombre_tecleado: 'Legal A Ficha',
      p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
    })
  const estado = async (c: Cliente) => {
    const r = await c.rpc('estado_firma_ficha', { p_nino_id: N })
    expect(r.error).toBeNull()
    const e = r.data as Record<string, unknown>
    return `firmada=${e.firmada} vigente=${e.vigente} refirma=${e.refirma_pedida} puede=${e.puede_firmar}`
  }
  const nFirmas = () =>
    comoPostgres(`SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}'`)
  const matricula = async () =>
    (await serviceClient.from('matriculas').select('estado').eq('nino_id', N).single()).data?.estado
  /** Un dato sellado que cambia: el lugar de nacimiento, con la sesión de Dirección (`ninos_admin_all`). */
  let vuelta = 0
  const cambiarLugar = async () => {
    vuelta++
    const r = await s.dir
      .from('ninos')
      .update({ lugar_nacimiento: `Lugar Demo ${vuelta}` })
      .eq('id', N)
      .select('id')
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Ficha Firmada')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    const n = await createTestNino(centro.id, 'Nino Ficha Firmada')
    N = n.id
    await matricular(N, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A Ficha' })
    legalB = await createTestUser({ nombre: 'Legal B Ficha' })
    autorizado = await createTestUser({ nombre: 'Autorizado Ficha' })
    direccion = await createTestUser({ nombre: 'Direccion Ficha' })
    ids.push(legalA.id, legalB.id, autorizado.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(legalA.id, centro.id, 'tutor_legal')
    await asignarRol(legalB.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearVinculo(N, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    vinculoB = await crearVinculo(N, legalB.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: true,
    })
    await crearVinculo(N, autorizado.id, 'autorizado', {})
    // El alta, completa salvo la imagen: los datos del niño y de los tutores, y el acuse médico de A
    // para este niño (como `gastos-gestion.rls.test.ts`). Sin gastos ni servicios ofrecidos.
    await completarDatosAlta(N)
    const acuse = await serviceClient.from('consentimientos').insert({
      usuario_id: legalA.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
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
    s.aut = await clientFor(autorizado)
    s.dir = await clientFor(direccion)
  }, 120_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  it('B1 premisa: A y B tutores legales con la ficha médica, el autorizado no; sin firma y en alta', async () => {
    const tutor = comoPostgres(
      `SELECT string_agg(tipo_vinculo::text || ':' || coalesce(permisos->>'puede_ver_info_medica', '-'), ',' ORDER BY tipo_vinculo)
         FROM public.vinculos_familiares WHERE nino_id = '${N}' AND deleted_at IS NULL`
    )
    expect(tutor).toBe('tutor_legal_principal:true,tutor_legal_secundario:true,autorizado:-')
    expect(await estado(s.A)).toBe('firmada=false vigente=false refirma=false puede=si')
    expect(nFirmas()).toBe('0')
    expect(await matricula()).toBe('pendiente')
    // El autorizado no pregunta por la firma: 42501.
    expect((await s.aut.rpc('estado_firma_ficha', { p_nino_id: N })).error?.code).toBe('42501')
  })

  let H1: string
  it('B2 sin la respuesta de imagen de quien firma, no se firma (imagen_sin_respuesta)', async () => {
    const v = await ver(s.A)
    expect(v.error).toBeNull()
    H1 = v.hash!
    expect(H1).toMatch(/^[0-9a-f]{64}$/)
    const r = await firmar(s.A, H1)
    expect(r.error?.hint).toBe('imagen_sin_respuesta')
    expect(nFirmas()).toBe('0')
    expect(await matricula()).toBe('pendiente')
  })

  it('B3 la imagen no entra en el sello; un dato sellado cambiado entre ver y firmar sí (ficha_cambiada)', async () => {
    const o = await s.A.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_version: 'v1.0',
      p_metodo: 'checkbox',
    })
    expect(o.error).toBeNull()
    expect((await ver(s.A)).hash).toBe(H1)
    await cambiarLugar()
    const r = await firmar(s.A, H1)
    expect(r.error?.hint).toBe('ficha_cambiada')
    expect(nFirmas()).toBe('0')
  })

  let H2: string
  it('B4 ver la ficha para firmar deja su lectura en lecturas_ficha_medica (origen alta)', async () => {
    const lecturas = () =>
      comoPostgres(
        `SELECT count(*) FROM public.lecturas_ficha_medica WHERE nino_id = '${N}' AND origen::text = 'alta'`
      )
    const antes = Number(lecturas())
    const v = await ver(s.A)
    expect(v.error).toBeNull()
    H2 = v.hash!
    expect(H2).not.toBe(H1)
    expect(Number(lecturas())).toBe(antes + 1)
  })

  it('B5 firmar cierra el alta, y la foto descifrada lleva la imagen y da el sello', async () => {
    const r = await firmar(s.A, H2)
    expect(r.error).toBeNull()
    expect(r.data).toMatch(/^[0-9a-f-]{36}$/)
    expect(await matricula()).toBe('lista')
    const fila = await s.A.from('firmas_ficha')
      .select('contenido_sha256, ficha_version, plantilla_pdf_version, rol_firmante, metodo_firma')
      .eq('nino_id', N)
    expect(fila.error).toBeNull()
    expect(fila.data).toEqual([
      {
        contenido_sha256: H2,
        ficha_version: 1,
        plantilla_pdf_version: 1,
        rol_firmante: 'tutor_legal_principal',
        metodo_firma: 'digital',
      },
    ])
    const foto = comoPostgres(
      `SELECT (privado.ficha_hash(extensions.pgp_sym_decrypt(f.contenido_cifrado, public._get_medical_key())::jsonb) = f.contenido_sha256)::text
              || '|' || (SELECT string_agg((e->>'usuario_id' = '${legalA.id}')::text || ':' || (e->>'respuesta') || ':' || ((e->>'aceptado_en') IS NOT NULL)::text, ',')
                           FROM jsonb_array_elements(extensions.pgp_sym_decrypt(f.contenido_cifrado, public._get_medical_key())::jsonb->'imagen') e)
         FROM public.firmas_ficha f WHERE f.nino_id = '${N}'`
    )
    expect(foto).toBe('true|true:si:true')
    expect(await estado(s.A)).toBe('firmada=true vigente=true refirma=false puede=si')
  })

  it('B6 un cambio de un dato sellado invalida la firma, y la fila no cambia', async () => {
    await cambiarLugar()
    expect(await estado(s.A)).toBe('firmada=true vigente=false refirma=false puede=si')
    expect(
      comoPostgres(
        `SELECT count(*) || ':' || min(contenido_sha256) FROM public.firmas_ficha WHERE nino_id = '${N}'`
      )
    ).toBe(`1:${H2}`)
  })

  it('B7 se vuelve a firmar en lista, y vale la nueva (la última por instante, no por id)', async () => {
    const v = await ver(s.A)
    expect(v.hash).not.toBe(H2)
    expect((await firmar(s.A, v.hash!)).error).toBeNull()
    expect(nFirmas()).toBe('2')
    expect(await matricula()).toBe('lista')
    expect(await estado(s.A)).toBe('firmada=true vigente=true refirma=false puede=si')
    // Que no sea un verde por azar: los dos instantes son distintos (clock_timestamp, no now()).
    expect(
      comoPostgres(
        `SELECT count(DISTINCT firmado_at) FROM public.firmas_ficha WHERE nino_id = '${N}'`
      )
    ).toBe('2')
  })

  it('B7b el «no» de la imagen después de firmar no invalida la firma', async () => {
    const d = await s.A.rpc('denegar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_version: 'v1.0',
      p_metodo: 'checkbox',
    })
    expect(d.error).toBeNull()
    expect(
      comoPostgres(
        `SELECT tipo::text FROM public.consentimientos WHERE nino_id = '${N}' AND usuario_id = '${legalA.id}'
           AND tipo::text IN ('imagen', 'imagen_denegada') AND revocado_en IS NULL`
      )
    ).toBe('imagen_denegada')
    expect(await estado(s.A)).toBe('firmada=true vigente=true refirma=false puede=si')
    expect(nFirmas()).toBe('2')
  })

  it('B8 con la firma vigente no hay nada que firmar', async () => {
    const v = await ver(s.A)
    expect((await firmar(s.A, v.hash!)).error?.hint).toBe('nada_que_firmar')
    expect(nFirmas()).toBe('2')
  })

  it('B9 sin el permiso de la ficha médica no se firma, y la pantalla puede decirlo; con él, sí', async () => {
    const permisos = async (valor: boolean) => {
      const r = await s.dir
        .from('vinculos_familiares')
        .update({ permisos: { puede_ver_info_medica: valor } })
        .eq('id', vinculoB)
        .select('id')
      expect(r.error).toBeNull()
      expect(r.data).toHaveLength(1)
    }
    await permisos(false)
    const v = await ver(s.B)
    expect(v.error?.code).toBe('42501')
    expect(v.error?.hint).toBe('sin_acceso_ficha_medica')
    expect(await estado(s.B)).toMatch(/puede=sin_acceso_ficha_medica$/)
    // Control positivo: con el permiso, B puede.
    await permisos(true)
    expect(await estado(s.B)).toMatch(/puede=si$/)
  })

  it('B10 por columnas: la sesión no lee el trazo de la tabla; lo da contenido_firmas_ficha, y al autorizado nada', async () => {
    const trazo = await s.A.from('firmas_ficha').select('firma_imagen').eq('nino_id', N)
    expect(trazo.error?.code).toBe('42501')
    const foto = await s.A.from('firmas_ficha').select('contenido_cifrado').eq('nino_id', N)
    expect(foto.error?.code).toBe('42501')
    const filas = await s.A.from('firmas_ficha').select('id, rol_firmante').eq('nino_id', N)
    expect(filas.error).toBeNull()
    expect(filas.data).toHaveLength(2)
    const c = await s.A.rpc('contenido_firmas_ficha', {
      p_firma_ids: filas.data!.map((f) => f.id),
    })
    expect(c.error).toBeNull()
    expect(c.data?.map((f) => f.nombre_tecleado)).toEqual(['Legal A Ficha', 'Legal A Ficha'])
    // El autorizado: ni la fila ni el contenido.
    const aut = await s.aut.from('firmas_ficha').select('id').eq('nino_id', N)
    expect(aut.error).toBeNull()
    expect(aut.data).toEqual([])
    const autC = await s.aut.rpc('contenido_firmas_ficha', {
      p_firma_ids: filas.data!.map((f) => f.id),
    })
    expect(autC.data).toEqual([])
    // Nadie escribe la tabla con sesión.
    const ins = await s.A.from('firmas_ficha').insert({
      nino_id: N,
      firmante_id: legalA.id,
      rol_firmante: 'tutor_legal_principal',
      metodo_firma: 'digital',
      nombre_tecleado: 'x',
      firma_imagen: 'x',
      ficha_version: 1,
      plantilla_pdf_version: 1,
      contenido_cifrado: '\\x00',
      contenido_sha256: H2,
    })
    expect(ins.error?.code).toBe('42501')
  })

  it('B11 Dirección pide refirma (el tutor no puede), y la firma deja de valer', async () => {
    expect((await s.A.rpc('pedir_refirma_ficha', { p_nino_id: N })).error?.code).toBe('42501')
    const r = await s.dir.rpc('pedir_refirma_ficha', { p_nino_id: N })
    expect(r.error).toBeNull()
    expect(await estado(s.A)).toBe('firmada=true vigente=false refirma=true puede=si')
  })

  it('B12 en papel: Dirección registra la firma presencial, sin trazo y con rol admin', async () => {
    const v = await ver(s.dir)
    expect(v.error).toBeNull()
    // El tutor legal no registra una firma en papel: es de Dirección en persona.
    const tutor = await s.A.rpc('registrar_firma_ficha_presencial', {
      p_nino_id: N,
      p_hash_visto: v.hash!,
      p_nombre_tecleado: 'Legal A Ficha',
    })
    expect(tutor.error?.code).toBe('42501')
    expect(nFirmas()).toBe('2')
    const r = await s.dir.rpc('registrar_firma_ficha_presencial', {
      p_nino_id: N,
      p_hash_visto: v.hash!,
      p_nombre_tecleado: 'Legal A Ficha',
    })
    expect(r.error).toBeNull()
    const fila = await s.dir
      .from('firmas_ficha')
      .select('rol_firmante, metodo_firma, firmante_id')
      .eq('id', r.data as string)
    expect(fila.data).toEqual([
      { rol_firmante: 'admin', metodo_firma: 'presencial', firmante_id: direccion.id },
    ])
    const c = await s.dir.rpc('contenido_firmas_ficha', { p_firma_ids: [r.data as string] })
    expect(c.data?.[0]?.firma_imagen).toBeNull()
    expect(await estado(s.A)).toBe('firmada=true vigente=true refirma=false puede=si')
  })

  it('B13 la firma no cambia: service_role sin privilegio, y postgres choca con el trigger', async () => {
    // El privilegio, del catálogo: el 42501 de la API de abajo no basta solo. Ese UPDATE filtra por
    // nino_id y devuelve id, y sin SELECT en la tabla también da 42501: con UPDATE concedido seguía
    // verde (mutación M19 en la CI, 2026-11-18).
    expect(
      comoPostgres(
        `SELECT has_table_privilege('service_role', 'public.firmas_ficha', 'UPDATE')::text || ':' ||
                has_table_privilege('authenticated', 'public.firmas_ficha', 'UPDATE')::text`
      )
    ).toBe('false:false')
    const u = await serviceClient
      .from('firmas_ficha')
      .update({ nombre_tecleado: 'otro' })
      .eq('nino_id', N)
      .select('id')
    expect(u.error?.code).toBe('42501')
    let stderr = ''
    try {
      comoPostgres(`UPDATE public.firmas_ficha SET nombre_tecleado = 'otro' WHERE nino_id = '${N}'`)
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? e)
    }
    expect(stderr).toMatch(/firma_inmutable/)
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}' AND nombre_tecleado = 'otro'`
      )
    ).toBe('0')
  })

  it('B14 la purga del niño se lleva sus firmas y sus peticiones, y no queda nada suyo en ningún bucket', async () => {
    const cuenta = () =>
      comoPostgres(
        `SELECT (SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}') || ':' ||
                (SELECT count(*) FROM public.refirmas_ficha WHERE nino_id = '${N}')`
      )
    /** Los objetos bajo `{centro}/{niño}/` de cada bucket que existe. */
    const objetos = async () => {
      const { data: buckets, error } = await serviceClient.storage.listBuckets()
      expect(error).toBeNull()
      const fuera: string[] = []
      for (const b of buckets ?? []) {
        const l = await serviceClient.storage.from(b.id).list(`${centro.id}/${N}`)
        for (const o of l.data ?? []) fuera.push(`${b.id}/${o.name}`)
      }
      return { buckets: (buckets ?? []).length, fuera: fuera.sort() }
    }
    // Premisa: tres firmas y una petición; y control positivo del barrido: un objeto del niño en
    // un bucket que el olvido recorre por prefijo (`FUENTES_ADJUNTOS`) se ve antes de purgar.
    expect(cuenta()).toBe('3:1')
    const control = `${centro.id}/${N}/control-ficha.pdf`
    const sube = await serviceClient.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(control, new TextEncoder().encode('%PDF-1.4\n%control\n%%EOF\n'), {
        contentType: 'application/pdf',
      })
    expect(sube.error).toBeNull()
    const antes = await objetos()
    expect(antes.buckets).toBeGreaterThan(5)
    expect(antes.fuera).toContain(`${BUCKET_JUSTIFICANTES_GESTION}/control-ficha.pdf`)

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
    expect(cuenta()).toBe('0:0')
    expect((await objetos()).fuera).toEqual([])
  })
})
