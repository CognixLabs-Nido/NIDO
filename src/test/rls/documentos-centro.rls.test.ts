import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestUser,
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

/** Un PDF de mentira con algo propio dentro, para que cada uno tenga su hash. */
function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO: ${texto}\n%%EOF\n`)
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/**
 * Como `postgres`, sin JWT, por psql contra la BD efímera del CI (`DB_URL`), igual que
 * `remesa-como-sus-funciones.ts`: lo que no alcanza ningún cliente de la app. Devuelve la salida o
 * el mensaje de error.
 */
function comoPostgres(sql: string): { ok: boolean; salida: string } {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  try {
    const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, salida }
  } catch (e) {
    return { ok: false, salida: String((e as { stderr?: string }).stderr ?? e) }
  }
}

/**
 * Documentos del centro (1a, `20270101120000`), contra la BD y el Storage del CI. Una versión no
 * cambia nunca, ni su fichero: tampoco para service_role, ni para postgres con los triggers puestos
 * (postgres conserva la llave de quitarlos o apagarlos, por decisión: spec, 1a). Varios presupuestos
 * vivos a la vez, uno por curso; solo la admin. Fixtures ficticios, fechados el 2026-11-05.
 */
describe('Los documentos del centro y sus versiones', () => {
  let centro: TestCentro
  let admin: TestUser
  let directora: TestUser
  let profe: TestUser
  let cursoActivo: string
  let cursoPlan: string
  let presupuesto: string
  const v1 = pdf('presupuesto 2026-27 v1')
  const v2 = pdf('presupuesto 2026-27 v2 corregida')
  const p27 = pdf('presupuesto 2027-28')

  const ruta = (doc: string, bytes: Uint8Array) => `${centro.id}/${doc}/${sha(bytes)}.pdf`

  async function objetosDelCentro(): Promise<string[]> {
    const { data: carpetas, error } = await serviceClient.storage.from(BUCKET).list(centro.id)
    expect(error).toBeNull()
    const nombres: string[] = []
    for (const c of carpetas ?? []) {
      const { data } = await serviceClient.storage.from(BUCKET).list(`${centro.id}/${c.name}`)
      for (const f of data ?? []) nombres.push(`${centro.id}/${c.name}/${f.name}`)
    }
    return nombres.sort()
  }

  async function lista() {
    const { data, error } = await (
      await clientFor(admin)
    ).rpc('documentos_centro_admin', {
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    return data as {
      documentos: {
        id: string
        versiones: {
          id: string
          curso_academico_id: string | null
          numero: number
          vigente: boolean
          sha256: string
        }[]
      }[]
      ficheros_sueltos: string[]
    }
  }

  async function vigentes(doc: string): Promise<Record<string, number>> {
    const d = (await lista()).documentos.find((x) => x.id === doc)
    return Object.fromEntries(
      (d?.versiones ?? [])
        .filter((v) => v.vigente)
        .map((v) => [v.curso_academico_id ?? 'sin', v.numero])
    )
  }

  async function bajar(r: string): Promise<string | null> {
    const { data, error } = await serviceClient.storage.from(BUCKET).download(r)
    if (error || !data) return null
    return sha(new Uint8Array(await data.arrayBuffer()))
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Documentos')
    cursoActivo = (await createTestCurso(centro.id, 'activo')).id
    cursoPlan = (await createTestCurso(centro.id, 'planificado')).id
    admin = await createTestUser({ nombre: 'Admin Documentos' })
    directora = await createTestUser({ nombre: 'Directora Documentos' })
    profe = await createTestUser({ nombre: 'Profe Documentos' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    const { data, error } = await (
      await clientFor(admin)
    ).rpc('crear_documento_centro', {
      p_centro_id: centro.id,
      p_titulo: 'Presupuesto y tarifas',
      p_de_curso: true,
      p_obligatorio: true,
      p_orden: 1,
    })
    expect(error).toBeNull()
    presupuesto = data!
  })

  afterAll(async () => {
    if (!centro) return
    // Las versiones solo se borran por su función o con su marcador: aquí, como postgres, fila a fila.
    const id = centro.id
    comoPostgres(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT id FROM public.documentos_centro_versiones WHERE centro_id = '${id}' LOOP
        PERFORM set_config('app.borrar_version_documento', r.id::text, true);
        DELETE FROM public.documentos_centro_versiones WHERE id = r.id;
      END LOOP;
      DELETE FROM public.documentos_centro WHERE centro_id = '${id}';
    END $$;`)
    const sueltos = await objetosDelCentro()
    if (sueltos.length) await serviceClient.storage.from(BUCKET).remove(sueltos)
    await deleteTestCentro(id)
    for (const u of [admin, directora, profe]) if (u) await deleteTestUser(u.id)
  })

  it('la admin sube una versión: el fichero se llama por el hash de sus bytes', async () => {
    // Premisa: el bucket es privado y el centro no tiene ningún fichero.
    const { data: bucket } = await serviceClient.storage.getBucket(BUCKET)
    expect(bucket?.public).toBe(false)
    expect(await objetosDelCentro()).toEqual([])

    const r = await subirVersionDocumento(await clientFor(admin), serviceClient, {
      centroId: centro.id,
      documentoId: presupuesto,
      cursoId: cursoActivo,
      bytes: v1,
    })
    expect(r).toEqual({ ok: true, data: { versionId: expect.any(String), sha256: sha(v1) } })
    expect(await objetosDelCentro()).toEqual([ruta(presupuesto, v1)])
    expect(await bajar(ruta(presupuesto, v1))).toBe(sha(v1))
    expect(await vigentes(presupuesto)).toEqual({ [cursoActivo]: 1 })
  })

  it('varios presupuestos vivos a la vez: la vigente es la de cada curso', async () => {
    const sesion = await clientFor(admin)
    const plan = await subirVersionDocumento(sesion, serviceClient, {
      centroId: centro.id,
      documentoId: presupuesto,
      cursoId: cursoPlan,
      bytes: p27,
    })
    expect(plan.ok).toBe(true)
    const corregida = await subirVersionDocumento(sesion, serviceClient, {
      centroId: centro.id,
      documentoId: presupuesto,
      cursoId: cursoActivo,
      bytes: v2,
    })
    expect(corregida.ok).toBe(true)
    expect(await vigentes(presupuesto)).toEqual({ [cursoActivo]: 2, [cursoPlan]: 1 })
    // El mismo fichero otra vez no es otra versión, y no se queda suelto.
    expect(
      await subirVersionDocumento(sesion, serviceClient, {
        centroId: centro.id,
        documentoId: presupuesto,
        cursoId: cursoActivo,
        bytes: v1,
      })
    ).toEqual({ ok: false, error: 'documentos_centro.errors.ya_subida' })
    expect((await lista()).ficheros_sueltos).toEqual([])
  })

  it('solo la admin (J1), y solo un PDF: lo demás no sube nada', async () => {
    const antes = await objetosDelCentro()
    for (const u of [directora, profe]) {
      expect
        .soft(
          await subirVersionDocumento(await clientFor(u), serviceClient, {
            centroId: centro.id,
            documentoId: presupuesto,
            cursoId: cursoActivo,
            bytes: pdf(u.id),
          }),
          u.email
        )
        .toEqual({ ok: false, error: 'documentos_centro.errors.no_autorizado' })
    }
    expect(
      await subirVersionDocumento(await clientFor(admin), serviceClient, {
        centroId: centro.id,
        documentoId: presupuesto,
        cursoId: cursoActivo,
        bytes: new TextEncoder().encode('no soy un pdf'),
      })
    ).toEqual({ ok: false, error: 'documentos_centro.errors.tipo_pdf' })
    expect(await objetosDelCentro()).toEqual(antes)
  })

  it('el fichero de una versión no lo sustituye ni lo borra ni service_role, y se sigue leyendo', async () => {
    const r = ruta(presupuesto, v1)
    // Premisa: está y se lee entero.
    expect(await bajar(r)).toBe(sha(v1))

    const sustituir = await serviceClient.storage
      .from(BUCKET)
      .upload(r, pdf('otro contenido'), { contentType: 'application/pdf', upsert: true })
    expect(sustituir.error).not.toBeNull()
    await serviceClient.storage.from(BUCKET).remove([r])
    // Sigue ahí, con el mismo contenido, y se lee (la lectura no la frena el trigger).
    expect(await bajar(r)).toBe(sha(v1))
    expect(await objetosDelCentro()).toContain(r)
  })

  it('ni service_role ni postgres cambian una versión: solo se borra por su función', async () => {
    // Sin tipo a propósito: la tabla no está en los tipos generados, y ningún cliente la tiene que
    // poder nombrar. Aquí se mide que service_role, aunque la nombre, no tiene privilegios.
    const sinTipo = serviceClient as unknown as SupabaseClient
    const upd = await sinTipo
      .from('documentos_centro_versiones')
      .update({ bytes: 1 })
      .eq('documento_id', presupuesto)
    expect(upd.error?.code).toBe('42501')

    const id = (await lista()).documentos.find((d) => d.id === presupuesto)!.versiones[0]!.id
    const cambiar = comoPostgres(
      `UPDATE public.documentos_centro_versiones SET bytes = 1 WHERE id = '${id}';`
    )
    expect.soft(cambiar.ok).toBe(false)
    expect.soft(cambiar.salida).toContain('no cambia nunca')
    const borrar = comoPostgres(
      `DELETE FROM public.documentos_centro_versiones WHERE id = '${id}';`
    )
    expect.soft(borrar.ok).toBe(false)
    expect.soft(borrar.salida).toContain('borrar_version_documento')
    // Control positivo del instrumento: una lectura como postgres sí pasa.
    expect(
      comoPostgres(`SELECT count(*) FROM public.documentos_centro_versiones WHERE id = '${id}';`)
    ).toEqual({
      ok: true,
      salida: '1\n',
    })
  })

  it('J5: la admin borra una versión sin firmas, con su fichero, y queda quién lo hizo', async () => {
    const corregida = (await lista()).documentos
      .find((d) => d.id === presupuesto)!
      .versiones.find((v) => v.sha256 === sha(v2))!
    expect(
      await borrarVersionDocumento(await clientFor(directora), serviceClient, corregida.id)
    ).toEqual({ ok: false, error: 'documentos_centro.errors.no_autorizado' })
    expect(await bajar(ruta(presupuesto, v2))).toBe(sha(v2))

    expect(
      await borrarVersionDocumento(await clientFor(admin), serviceClient, corregida.id)
    ).toEqual({
      ok: true,
      data: { ficheroBorrado: true },
    })
    expect(await objetosDelCentro()).not.toContain(ruta(presupuesto, v2))
    // La v1 vuelve a ser la vigente de su curso; la del otro curso no se toca.
    expect(await vigentes(presupuesto)).toEqual({ [cursoActivo]: 1, [cursoPlan]: 1 })
    const { data: eventos } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'documento_centro')
      .eq('registro_id', centro.id)
    const borrada = (eventos ?? []).filter(
      (e) => (e.valores_despues as { accion?: string })?.accion === 'version_borrada'
    )
    expect(borrada.map((e) => e.usuario_id)).toEqual([admin.id])
  })

  it('el trigger de Storage es solo de este bucket: en otro, service_role sí sustituye', async () => {
    const r = `${centro.id}/control-${Date.now()}.pdf`
    const libro = serviceClient.storage.from('libro-familia')
    expect(
      (await libro.upload(r, pdf('a'), { contentType: 'application/pdf', upsert: true })).error
    ).toBeNull()
    expect(
      (await libro.upload(r, pdf('b'), { contentType: 'application/pdf', upsert: true })).error
    ).toBeNull()
    expect((await libro.remove([r])).error).toBeNull()
  })
})
