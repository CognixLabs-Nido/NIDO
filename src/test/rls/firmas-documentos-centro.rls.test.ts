import { execFileSync } from 'node:child_process'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

vi.mock('server-only', () => ({}))

const { borrarVersionDocumento, subirVersionDocumento } =
  await import('@/features/documentos-centro/lib/versiones')

const BUCKET = 'documentos-centro'
const BAJA = '1990-01-01T10:00:00+00:00'

function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO 1b: ${texto}\n%%EOF\n`)
}

/** Como `postgres`, sin JWT, por psql contra la BD efímera del CI (`DB_URL`), como en el 1a. */
function comoPostgres(sql: string): { ok: boolean; salida: string } {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  try {
    const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, salida: salida.trim() }
  } catch (e) {
    return { ok: false, salida: String((e as { stderr?: string }).stderr ?? e) }
  }
}

/**
 * Las firmas de los documentos del centro (1b, `20270102120000`), contra la BD del CI. Una por
 * versión y niño (J3) con la copia de lo firmado; una versión firmada no se borra nunca (J5), tampoco
 * con la llave de postgres en modo replica, por el primer `ENABLE ALWAYS` del esquema; y la retención
 * de las firmas de autorizaciones. Fixtures ficticios, fechados el 2026-11-05.
 */
describe('Las firmas de los documentos del centro', () => {
  let centro: TestCentro
  let admin: TestUser
  let directora: TestUser
  let profe: TestUser
  let madre: TestUser
  let otro: TestUser
  let curso: string
  let lucia: string
  let inigo: string
  let presupuesto: string
  let normas: string
  let v1: string
  let v2: string
  let sinFirmas: string

  /** Firma como postgres (el paso 2 traerá la función de firmar). Devuelve el id o el error. */
  function firmar(version: string, nino: string, firmante: string, extra = ''): string {
    const r = comoPostgres(`INSERT INTO public.firmas_documentos_centro
        (version_id, documento_id, centro_id, titulo, numero, sha256, nino_id, firmante_id,
         rol_firmante, nombre_tecleado, firma_imagen${extra ? ', ' + extra.split('=')[0] : ''})
      VALUES ('${version}', gen_random_uuid(), gen_random_uuid(), 'MENTIRA', 99, repeat('0', 64),
              '${nino}', '${firmante}', 'tutor_legal_principal', 'Madre Ensayo',
              'data:image/png;base64,AAAA'${extra ? ', ' + extra.split('=')[1] : ''})
      RETURNING id;`)
    return r.ok ? r.salida : `ERROR ${r.salida}`
  }

  function cuenta(where: string): number {
    const r = comoPostgres(`SELECT count(*) FROM public.firmas_documentos_centro WHERE ${where};`)
    expect(r.ok, r.salida).toBe(true)
    return Number(r.salida)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Firmas Documentos')
    curso = (await createTestCurso(centro.id, 'activo')).id
    admin = await createTestUser({ nombre: 'Admin Firmas Documentos' })
    directora = await createTestUser({ nombre: 'Directora Firmas Documentos' })
    profe = await createTestUser({ nombre: 'Profe Firmas Documentos' })
    madre = await createTestUser({ nombre: 'Madre Firmas Documentos' })
    otro = await createTestUser({ nombre: 'Otro Firmas Documentos' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    inigo = (await createTestNino(centro.id, 'Íñigo')).id
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    await crearVinculo(inigo, madre.id, 'tutor_legal_principal')

    const sesion = await clientFor(admin)
    const crea = async (titulo: string, deCurso: boolean, orden: number) => {
      const { data, error } = await sesion.rpc('crear_documento_centro', {
        p_centro_id: centro.id,
        p_titulo: titulo,
        p_de_curso: deCurso,
        p_obligatorio: true,
        p_orden: orden,
      })
      expect(error).toBeNull()
      return data!
    }
    presupuesto = await crea('Presupuesto y tarifas', true, 1)
    normas = await crea('Normas de funcionamiento', false, 2)
    const sube = async (doc: string, cursoId: string | null, texto: string) => {
      const r = await subirVersionDocumento(sesion, serviceClient, {
        centroId: centro.id,
        documentoId: doc,
        cursoId,
        bytes: pdf(texto),
      })
      if (!r.ok) throw new Error(`subir: ${r.error}`)
      return r.data.versionId
    }
    v1 = await sube(presupuesto, curso, 'presupuesto v1')
    v2 = await sube(presupuesto, curso, 'presupuesto v2 corregida')
    sinFirmas = await sube(normas, null, 'normas v1')
  })

  afterAll(async () => {
    if (!centro) return
    const id = centro.id
    // Las firmas primero (si no, la versión firmada no se borra: es lo que se prueba), después las
    // versiones con su marcador, como en el 1a.
    comoPostgres(`DO $$ DECLARE r record; BEGIN
      DELETE FROM public.firmas_documentos_centro WHERE centro_id = '${id}';
      FOR r IN SELECT id FROM public.documentos_centro_versiones WHERE centro_id = '${id}' LOOP
        PERFORM set_config('app.borrar_version_documento', r.id::text, true);
        DELETE FROM public.documentos_centro_versiones WHERE id = r.id;
      END LOOP;
      DELETE FROM public.documentos_centro WHERE centro_id = '${id}';
    END $$;`)
    const { data: carpetas } = await serviceClient.storage.from(BUCKET).list(id)
    for (const c of carpetas ?? []) {
      const { data } = await serviceClient.storage.from(BUCKET).list(`${id}/${c.name}`)
      const rutas = (data ?? []).map((f) => `${id}/${c.name}/${f.name}`)
      if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
    }
    await deleteTestCentro(id)
    for (const u of [admin, directora, profe, madre, otro]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: sin firmas, y los dos triggers de la versión firmada en ENABLE ALWAYS', () => {
    expect(cuenta(`centro_id = '${centro.id}'`)).toBe(0)
    const r = comoPostgres(`SELECT string_agg(tgname || '=' || tgenabled, ',' ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid = 'public.documentos_centro_versiones'::regclass
       AND tgname LIKE 'documentos_centro_versiones_firmada%';`)
    expect(r.salida).toBe(
      'documentos_centro_versiones_firmada=A,documentos_centro_versiones_firmada_truncate=A'
    )
  })

  it('la firma guarda lo firmado de la versión, aunque quien firma diga otra cosa (J3, J4)', () => {
    const id = firmar(v1, lucia, madre.id)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const r =
      comoPostgres(`SELECT titulo || '|' || numero || '|' || coalesce(curso_nombre, '-') || '|'
        || (documento_id = '${presupuesto}') || '|' || (centro_id = '${centro.id}') || '|'
        || (sha256 = (SELECT sha256 FROM public.documentos_centro_versiones WHERE id = '${v1}'))
      FROM public.firmas_documentos_centro WHERE id = '${id}';`)
    const nombreCurso = comoPostgres(
      `SELECT nombre FROM public.cursos_academicos WHERE id = '${curso}';`
    ).salida
    expect(r.salida).toBe(`Presupuesto y tarifas|1|${nombreCurso}|true|true|true`)
    // J3: una por versión y niño, no por firmante.
    expect(firmar(v1, lucia, madre.id)).toContain('firmas_documentos_centro_una_por_nino')
    // J4: otra versión del mismo curso es otra firma.
    expect(firmar(v2, lucia, madre.id)).toMatch(/^[0-9a-f-]{36}$/)
    expect(cuenta(`nino_id = '${lucia}'`)).toBe(2)
  })

  it('el niño tiene que ser del centro del documento', async () => {
    const fuera = await createTestCentro('Centro Firmas Documentos Fuera')
    try {
      const ajeno = (await createTestNino(fuera.id, 'Ajeno')).id
      expect(firmar(v1, ajeno, madre.id)).toContain('centro_ajeno')
    } finally {
      await deleteTestCentro(fuera.id)
    }
  })

  it('leen quien firmó, la familia y la Dirección; nadie la escribe ni la borra con sesión', async () => {
    const lee = async (u: TestUser) => {
      const { data, error } = await (await clientFor(u))
        .from('firmas_documentos_centro')
        .select('id')
        .eq('nino_id', lucia)
      expect(error).toBeNull()
      return (data ?? []).length
    }
    // Premisa: hay dos firmas de Lucía.
    expect(cuenta(`nino_id = '${lucia}'`)).toBe(2)
    expect.soft(await lee(madre)).toBe(2)
    expect.soft(await lee(admin)).toBe(2)
    expect.soft(await lee(directora)).toBe(2)
    expect.soft(await lee(profe)).toBe(0)
    expect.soft(await lee(otro)).toBe(0)

    const sesion = await clientFor(madre)
    const borra = await sesion.from('firmas_documentos_centro').delete().eq('nino_id', lucia)
    expect.soft(borra.error?.code).toBe('42501')
    const cambia = await sesion
      .from('firmas_documentos_centro')
      .update({ nombre_tecleado: 'X' })
      .eq('nino_id', lucia)
    expect.soft(cambia.error?.code).toBe('42501')
    expect(cuenta(`nino_id = '${lucia}'`)).toBe(2)
  })

  it('una firma no cambia, tampoco para postgres', () => {
    const r = comoPostgres(
      `UPDATE public.firmas_documentos_centro SET nombre_tecleado = 'X' WHERE nino_id = '${lucia}';`
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('firma_inmutable')
    // Control: la lectura del mismo camino sí funciona.
    expect(cuenta(`nino_id = '${lucia}' AND nombre_tecleado = 'Madre Ensayo'`)).toBe(2)
  })

  it('J5: la admin no borra una versión firmada; una sin firmas, sí', async () => {
    const sesion = await clientFor(admin)
    const firmada = await borrarVersionDocumento(sesion, serviceClient, v1)
    expect(firmada).toEqual({ ok: false, error: 'documentos_centro.errors.version_firmada' })
    const libre = await borrarVersionDocumento(sesion, serviceClient, sinFirmas)
    expect(libre).toEqual({ ok: true, data: { ficheroBorrado: true } })
  })

  it('J5 aguanta la llave de postgres: en modo replica no se borra ni se vacía', () => {
    // En una transacción: el control (un trigger normal NO dispara en replica) y los dos intentos.
    const r = comoPostgres(`
      CREATE TEMP TABLE t_ctl (x int);
      CREATE FUNCTION pg_temp.f_ctl() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'ctl'; END $f$;
      CREATE TRIGGER t_ctl_trg BEFORE INSERT ON t_ctl FOR EACH ROW EXECUTE FUNCTION pg_temp.f_ctl();
      DO $$ DECLARE r text := ''; h text; BEGIN
        SET LOCAL session_replication_role = replica;
        BEGIN INSERT INTO t_ctl VALUES (1); r := 'replica'; EXCEPTION WHEN OTHERS THEN r := 'SIN_replica'; END;
        PERFORM set_config('app.borrar_version_documento', '${v1}', true);
        BEGIN DELETE FROM public.documentos_centro_versiones WHERE id = '${v1}'; r := r || '|borra';
        EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS h = PG_EXCEPTION_HINT; r := r || '|' || h; END;
        RAISE NOTICE '%', r;
      END $$;
      SET session_replication_role = replica;
      TRUNCATE public.documentos_centro_versiones CASCADE;`)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('replica|version_firmada')
    expect(r.salida).toContain('hay versiones firmadas')
    expect(cuenta(`version_id = '${v1}'`)).toBe(1)
  })

  it('la retención: bloqueada con el niño purgado, y se destruye a los 5 años', async () => {
    const id = firmar(v1, inigo, madre.id)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const b = await serviceClient
      .from('ninos')
      .update({ deleted_at: BAJA, deleted_reason: 'baja_nino' })
      .eq('id', inigo)
    expect(b.error).toBeNull()
    const p = await serviceClient.rpc('purgar_expediente_nino', { p_nino_id: inigo, p_anios: 5 })
    expect(p.error).toBeNull()
    expect(p.data).toBe(true)

    // Bloqueada: la familia ya no la lee, y sale en Datos bloqueados con su código.
    const { data: leida } = await (await clientFor(madre))
      .from('firmas_documentos_centro')
      .select('id')
      .eq('nino_id', inigo)
    expect(leida ?? []).toEqual([])
    const bloq = comoPostgres(`SELECT e->>'codigo' || ':' || (e->>'n')
      FROM jsonb_array_elements(privado.datos_bloqueados('nino', '${inigo}', true)) e
      WHERE e->>'codigo' = 'firmas_documentos';`)
    expect(bloq.salida).toBe('firmas_documentos:1')
    const cont = comoPostgres(`SELECT jsonb_array_length(privado.contenido_bloqueado(
      '${centro.id}', 'nino', '${inigo}')->'firmas_documentos');`)
    expect(cont.salida).toBe('1')
    expect(comoPostgres(`SELECT privado.queda_conservado_nino('${inigo}');`).salida).toBe('t')

    // A los 5 años se destruye, y ya no conserva al niño.
    const d = await serviceClient.rpc('destruir_firmas_nino', { p_nino_id: inigo, p_anios: 5 })
    expect(d.error).toBeNull()
    expect((d.data as Record<string, number>).firmas_documentos).toBe(1)
    expect(cuenta(`nino_id = '${inigo}'`)).toBe(0)
    expect(comoPostgres(`SELECT privado.queda_conservado_nino('${inigo}');`).salida).toBe('f')
    // La versión sigue: lo que se destruye es la firma.
    expect(
      comoPostgres(`SELECT count(*) FROM public.documentos_centro_versiones WHERE id = '${v1}';`)
        .salida
    ).toBe('1')
  })
})
