import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { componerFichaFirmada } from '@/features/alta/lib/ficha-pdf'
import { copiaFichaFirmadaSchema } from '@/features/alta/lib/ficha-pdf/tipos'
import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import { BUCKET_JUSTIFICANTES_GESTION } from '@/shared/lib/adjuntos/storage'
import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import {
  anonClient,
  asignarProfeAula,
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
 * Fase 10c — leer la copia firmada de la ficha (`20270131120000`, `public.leer_ficha_firmada`) y
 * componer su PDF (`src/features/alta/lib/ficha-pdf`). Spec `docs/specs/altas-serie.md`, «10c: el
 * encargo, lo medido abierto y la condición de la (C)». Decidido por el responsable el 2026-11-19:
 * por una FUNCIÓN, abierta al tutor legal y a Dirección, no al autorizado ni a la profe; cada lectura
 * deja su fila en `lecturas_ficha_medica` con un origen nuevo; respeta el bloqueo tras el curso de la
 * baja; nada de URL pública; con la versión guardada se compone el mismo documento; y la purga se
 * lleva la fila sin dejar ningún objeto de la ficha en ningún bucket.
 *
 * Cada `it` parte del estado que deja el anterior.
 */
describe('la copia firmada de la ficha (fase 10c)', () => {
  let centro: { id: string }
  let N: string
  let F: string
  let legalA: TestUser
  let legalB: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let otro: TestUser
  let direccion: TestUser
  const s = {} as Record<'A' | 'B' | 'aut' | 'profe' | 'otro' | 'dir', Cliente>
  const ids: string[] = []

  const leer = (c: Cliente, firma = F) => c.rpc('leer_ficha_firmada', { p_firma_id: firma })
  const lecturas = () =>
    comoPostgres(
      `SELECT count(*) FROM public.lecturas_ficha_medica WHERE nino_id = '${N}' AND origen = 'ficha_firmada'`
    )
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
  /** Los objetos de storage, de TODOS los buckets y a cualquier profundidad, cuyo nombre lleva `x`. */
  const objetosCon = (x: string) =>
    comoPostgres(`SELECT count(*) FROM storage.objects WHERE name LIKE '%${x}%'`)

  beforeAll(async () => {
    centro = await createTestCentro('Centro Copia Firmada')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    N = (await createTestNino(centro.id, 'Nino Copia Firmada')).id
    const M = (await createTestNino(centro.id, 'Nino Otra Familia')).id
    await matricular(N, aula.id, curso.id)
    await matricular(M, aula.id, curso.id)
    legalA = await createTestUser({ nombre: 'Legal A Copia' })
    legalB = await createTestUser({ nombre: 'Legal B Copia' })
    autorizado = await createTestUser({ nombre: 'Autorizado Copia' })
    profe = await createTestUser({ nombre: 'Profe Copia' })
    otro = await createTestUser({ nombre: 'Legal Otra Familia' })
    direccion = await createTestUser({ nombre: 'Direccion Copia' })
    ids.push(legalA.id, legalB.id, autorizado.id, profe.id, otro.id, direccion.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    for (const u of [legalA, legalB, otro]) await asignarRol(u.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearVinculo(N, legalA.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    // B es tutor legal SIN el permiso de la ficha médica: no lee la copia (lleva lo médico).
    await crearVinculo(N, legalB.id, 'tutor_legal_secundario', { puede_ver_info_medica: false })
    await crearVinculo(N, autorizado.id, 'autorizado', { puede_ver_info_medica: true })
    await crearVinculo(M, otro.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    await completarDatosAlta(N)
    const libro = await serviceClient
      .from('ninos')
      .update({ libro_familia_path: `${centro.id}/${N}/libro-demo.pdf` })
      .eq('id', N)
    if (libro.error) throw new Error(`libro: ${libro.error.message}`)
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
    s.profe = await clientFor(profe)
    s.otro = await clientFor(otro)
    s.dir = await clientFor(direccion)

    // Lo médico que tiene que llevar la copia, y la firma de A (con su «sí» de imagen antes).
    // Vacío = NULL (20261123120000): solo la alergia grave queda escrita.
    const med = await s.dir.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: N,
      p_alergias_graves: 'Cacahuete Demo',
      p_notas_emergencia: '',
      p_medicacion_habitual: '',
      p_alergias_leves: '',
      p_medico_familia: '',
      p_telefono_emergencia: '',
    })
    if (med.error) throw new Error(`médica: ${med.error.message}`)
    const o = await s.A.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: N,
      p_tutor: legalA.id,
      p_version: 'v1.0',
      p_metodo: 'checkbox',
    })
    if (o.error) throw new Error(`imagen: ${o.error.message}`)
    const v = await s.A.rpc('ficha_para_firmar', { p_nino_id: N })
    if (v.error) throw new Error(`ver: ${v.error.message}`)
    const f = await s.A.rpc('firmar_ficha', {
      p_nino_id: N,
      p_hash_visto: (v.data as { hash: string }).hash,
      p_nombre_tecleado: 'Legal A Copia',
      p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
    })
    if (f.error) throw new Error(`firmar: ${f.error.message}`)
    F = comoPostgres(`SELECT id FROM public.firmas_ficha WHERE nino_id = '${N}'`)
  }, 120_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const id of ids) await deleteTestUser(id)
  }, 90_000)

  it('C0 premisa: una firma de A; quién es quién; ninguna lectura de la copia todavía', () => {
    expect(F).toMatch(/^[0-9a-f-]{36}$/)
    expect(
      comoPostgres(
        `SELECT string_agg(v.tipo_vinculo::text || ':' || coalesce(v.permisos->>'puede_ver_info_medica', '-'), ',' ORDER BY v.tipo_vinculo)
           FROM public.vinculos_familiares v WHERE v.nino_id = '${N}' AND v.deleted_at IS NULL`
      )
    ).toBe('tutor_legal_principal:true,tutor_legal_secundario:false,autorizado:true')
    // La profe es de verdad la del aula del niño, y el «otro» es tutor legal de otro niño, no de N.
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.profes_aulas pa JOIN public.matriculas m ON m.aula_id = pa.aula_id
          WHERE pa.profe_id = '${profe.id}' AND m.nino_id = '${N}' AND pa.deleted_at IS NULL`
      )
    ).toBe('1')
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.vinculos_familiares WHERE usuario_id = '${otro.id}' AND nino_id = '${N}'`
      )
    ).toBe('0')
    expect(lecturas()).toBe('0')
  })

  it('C+ A (tutor legal con el permiso) lee la copia: la foto que da el sello, y su lectura', async () => {
    const r = await leer(s.A)
    expect(r.error).toBeNull()
    const c = copiaFichaFirmadaSchema.parse(r.data)
    expect(c.firmaId).toBe(F)
    expect(c.contenidoSha256).toBe(
      comoPostgres(`SELECT contenido_sha256 FROM public.firmas_ficha WHERE id = '${F}'`)
    )
    expect((c.ficha.medico as Record<string, unknown>).alergias_graves).toBe('Cacahuete Demo')
    // Ni la IP ni el navegador.
    expect(Object.keys(r.data as object)).not.toContain('ip_address')
    expect(Object.keys(r.data as object)).not.toContain('user_agent')
    expect(lecturas()).toBe('1')
    expect(
      comoPostgres(
        `SELECT rol_lector || ':' || array_to_string(campos, ',') FROM public.lecturas_ficha_medica
          WHERE nino_id = '${N}' AND origen = 'ficha_firmada' AND lector_id = '${legalA.id}'`
      )
    ).toBe('tutor_legal:alergias_graves')
  })

  it('C+ Dirección del centro la lee, y su lectura dice que fue Dirección', async () => {
    const r = await leer(s.dir)
    expect(r.error).toBeNull()
    expect(lecturas()).toBe('2')
    expect(
      comoPostgres(
        `SELECT rol_lector FROM public.lecturas_ficha_medica
          WHERE nino_id = '${N}' AND origen = 'ficha_firmada' AND lector_id = '${direccion.id}'`
      )
    ).toBe('admin')
  })

  it('el autorizado, la profe, el tutor legal de otro niño y el que no tiene el permiso, no; ni sin sesión. Y no queda lectura', async () => {
    expect((await leer(s.aut)).error?.code).toBe('42501')
    expect((await leer(s.profe)).error?.code).toBe('42501')
    expect((await leer(s.otro)).error?.code).toBe('42501')
    const b = await leer(s.B)
    expect(b.error?.code).toBe('42501')
    expect(b.error?.hint).toBe('sin_acceso_ficha_medica')
    expect((await leer(anonClient())).error).not.toBeNull()
    // Un id que no es de ninguna firma da lo mismo que una que no se puede leer.
    expect((await leer(s.dir, '00000000-0000-4000-8000-000000000000')).error?.code).toBe('42501')
    expect(lecturas()).toBe('2')
  })

  it('con la versión guardada, el mismo documento: aunque los datos vivos cambien después', async () => {
    const pdf = async () => {
      const r = await leer(s.A)
      expect(r.error).toBeNull()
      const c = copiaFichaFirmadaSchema.parse(r.data)
      return { c, bytes: await componerFichaFirmada(c) }
    }
    const antes = await pdf()
    expect(antes.c.plantillaPdfVersion).toBe(1)
    const lugar = (antes.c.ficha.nino as Record<string, unknown>).lugar_nacimiento
    // Dirección cambia un dato firmado: la ficha viva ya no es la firmada.
    const u = await s.dir
      .from('ninos')
      .update({ lugar_nacimiento: 'Otro Lugar Demo' })
      .eq('id', N)
      .select('id')
    expect(u.error).toBeNull()
    expect(comoPostgres(`SELECT lugar_nacimiento FROM public.ninos WHERE id = '${N}'`)).toBe(
      'Otro Lugar Demo'
    )
    const despues = await pdf()
    expect((despues.c.ficha.nino as Record<string, unknown>).lugar_nacimiento).toBe(lugar)
    expect(sha(despues.bytes)).toBe(sha(antes.bytes))
  })

  it('una copia que no da el sello de su firma no se entrega', async () => {
    // Como postgres: una segunda firma con la foto de la primera y otro sello (la sesión no puede).
    const mala = comoPostgres(
      `INSERT INTO public.firmas_ficha (nino_id, firmante_id, rol_firmante, metodo_firma, nombre_tecleado, firma_imagen,
                                        firmado_at, ficha_version, plantilla_pdf_version, contenido_cifrado, contenido_sha256)
       SELECT nino_id, firmante_id, rol_firmante, metodo_firma, nombre_tecleado, firma_imagen,
              firmado_at - interval '1 day', ficha_version, plantilla_pdf_version, contenido_cifrado, repeat('0', 64)
         FROM public.firmas_ficha WHERE id = '${F}'
       RETURNING id`
    )
    try {
      const antes = lecturas()
      const r = await leer(s.dir, mala)
      expect(r.error?.code).toBe('XX001')
      expect(r.error?.hint).toBe('sello_distinto')
      expect(lecturas()).toBe(antes)
    } finally {
      comoPostgres(`DELETE FROM public.firmas_ficha WHERE id = '${mala}'`)
    }
  })

  it('la firma bloqueada por la retención (A olvidado) no se entrega', async () => {
    comoPostgres(
      `INSERT INTO public.olvido_solicitudes (sujeto_tipo, sujeto_id, centro_id, estado, confirmada_en, gracia_hasta, purgado_en)
       VALUES ('usuario', '${legalA.id}', '${centro.id}', 'confirmada', now(), now(), now())`
    )
    try {
      expect(
        comoPostgres(
          `SELECT privado.firma_ficha_bloqueada(nino_id, firmante_id, tutor_id)::text FROM public.firmas_ficha WHERE id = '${F}'`
        )
      ).toBe('true')
      const antes = lecturas()
      const r = await leer(s.dir)
      expect(r.error?.code).toBe('55000')
      expect(r.error?.hint).toBe('firma_bloqueada')
      expect(lecturas()).toBe(antes)
    } finally {
      comoPostgres(
        `DELETE FROM public.olvido_solicitudes WHERE sujeto_id = '${legalA.id}' AND centro_id = '${centro.id}'`
      )
    }
    expect((await leer(s.dir)).error).toBeNull()
  })

  it('tras el curso de la baja, la ficha médica bloqueada: tampoco la copia', async () => {
    // Un curso ya terminado y la baja del niño dentro de él (como postgres: el plazo cuelga del fin
    // de curso, y el de los fixtures no ha terminado).
    comoPostgres(
      `INSERT INTO public.cursos_academicos (centro_id, nombre, fecha_inicio, fecha_fin, estado)
       VALUES ('${centro.id}', 'Curso Pasado Copia', '2020-09-01', '2021-07-31', 'cerrado')`
    )
    comoPostgres(
      `UPDATE public.ninos SET deleted_reason = 'baja_nino', deleted_at = '2021-06-01 10:00+00' WHERE id = '${N}'`
    )
    try {
      expect(comoPostgres(`SELECT privado.ficha_medica_bloqueada_desde('${N}')::text`)).toBe(
        '2021-08-01'
      )
      const antes = lecturas()
      const r = await leer(s.dir)
      expect(r.error?.code).toBe('55000')
      expect(r.error?.hint).toBe('ficha_bloqueada')
      expect((await leer(s.A)).error).not.toBeNull()
      expect(lecturas()).toBe(antes)
    } finally {
      comoPostgres(
        `UPDATE public.ninos SET deleted_reason = NULL, deleted_at = NULL WHERE id = '${N}'`
      )
      comoPostgres(
        `DELETE FROM public.cursos_academicos WHERE centro_id = '${centro.id}' AND nombre = 'Curso Pasado Copia'`
      )
    }
    expect((await leer(s.dir)).error).toBeNull()
  })

  it('leer y componer no guarda nada; la purga se lleva la fila y no queda ningún objeto de la ficha en ningún bucket', async () => {
    const total = () => comoPostgres('SELECT count(*) FROM storage.objects')
    // Control positivo de la búsqueda: ve un objeto con el id de la firma FUERA de `{centro}/{niño}/`
    // (el barrido de B14 de la 10b-1 solo lista ese prefijo, un nivel).
    const fuera = `copia-control/${F}.pdf`
    const sube = await serviceClient.storage
      .from(BUCKET_JUSTIFICANTES_GESTION)
      .upload(fuera, new TextEncoder().encode('%PDF-1.4\n%control\n%%EOF\n'), {
        contentType: 'application/pdf',
      })
    expect(sube.error).toBeNull()
    expect(objetosCon(F)).toBe('1')
    expect(
      (await serviceClient.storage.from(BUCKET_JUSTIFICANTES_GESTION).remove([fuera])).error
    ).toBeNull()
    expect(objetosCon(F)).toBe('0')

    const antes = total()
    for (const c of [s.A, s.dir]) {
      const r = await leer(c)
      expect(r.error).toBeNull()
      await componerFichaFirmada(copiaFichaFirmadaSchema.parse(r.data))
    }
    expect(total()).toBe(antes)
    expect(objetosCon(F)).toBe('0')

    const firmas = () =>
      comoPostgres(
        `SELECT (SELECT count(*) FROM public.firmas_ficha WHERE nino_id = '${N}') || ':' ||
                (SELECT count(*) FROM public.refirmas_ficha WHERE nino_id = '${N}')`
      )
    expect(firmas()).toBe('1:0')
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
    expect(firmas()).toBe('0:0')
    expect(objetosCon(F)).toBe('0')
    expect(objetosCon(N)).toBe('0')
    // Y la copia ya no se entrega a nadie.
    expect((await leer(s.dir)).error?.code).toBe('42501')
  })
})
