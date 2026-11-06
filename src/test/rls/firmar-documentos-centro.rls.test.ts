import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
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
  type TestCentro,
  type TestUser,
} from './setup'

vi.mock('server-only', () => ({}))

const { subirVersionDocumento } = await import('@/features/documentos-centro/lib/versiones')

const BUCKET = 'documentos-centro'
type Cliente = SupabaseClient<Database>

function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO 2a: ${texto}\n%%EOF\n`)
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Como `postgres`, por psql contra la BD efímera del CI, como en los tests del 3a y el 3b. */
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

/** El código y el HINT de un error de la base, o 'ok'. */
function resultado(error: { code?: string; hint?: string | null } | null): string {
  if (!error) return 'ok'
  return error.hint ? `${error.code} ${error.hint}` : String(error.code)
}

/**
 * Firmar los documentos del centro (fase 4, 4a, `20270103120000`), contra la BD y el Storage del CI:
 * qué le toca a cada niño (con sus tres estados y J4), quién lo lee, quién firma con el dedo y quién
 * en persona (no el superusuario), el PDF de lo que firma, la lista del centro, y el acuse médico del
 * cierre del alta, por niño (U-3 en la base). Fixtures ficticios, del 2026-11-05.
 */
describe('Firmar los documentos del centro', () => {
  let centro: TestCentro
  let fuera: TestCentro
  let cursoActivo: string
  let cursoPlan: string
  let admin: TestUser
  let directora: TestUser
  let superU: TestUser
  let profe: TestUser
  let madre: TestUser
  let padre: TestUser
  let autorizada: TestUser
  let otra: TestUser
  let lucia: string
  let inigo: string
  let pablo: string
  let ajeno: string
  let presupuesto: string
  let normas: string
  let pActivo1: string
  let normas1: string
  const sesiones = new Map<string, Cliente>()
  const como = async (u: TestUser): Promise<Cliente> => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  async function sube(doc: string, cursoId: string | null, texto: string): Promise<string> {
    const r = await subirVersionDocumento(await como(admin), serviceClient, {
      centroId: centro.id,
      documentoId: doc,
      cursoId,
      bytes: pdf(texto),
    })
    if (!r.ok) throw new Error(`subir: ${r.error}`)
    return r.data.versionId
  }
  async function estados(u: TestUser, nino: string): Promise<string> {
    const { data, error } = await (await como(u)).rpc('documentos_firma_nino', { p_nino_id: nino })
    if (error) return resultado(error)
    return (data ?? [])
      .map((d) => `${d.titulo}${d.curso_nombre ? `/${d.curso_nombre}` : ''}=${d.estado}`)
      .join(', ')
  }
  async function firma(u: TestUser, version: string, nino: string): Promise<string> {
    const { error } = await (
      await como(u)
    ).rpc('firmar_documento_centro', {
      p_version_id: version,
      p_nino_id: nino,
      p_nombre_tecleado: '  Madre Ensayo  ',
      p_firma_imagen: 'data:image/png;base64,AAAA',
      p_ip_address: '203.0.113.7',
      p_user_agent: 'ensayo',
    })
    return resultado(error)
  }
  async function presencial(u: TestUser, version: string, nino: string): Promise<string> {
    const { error } = await (
      await como(u)
    ).rpc('registrar_firma_documento_presencial', {
      p_version_id: version,
      p_nino_id: nino,
      p_nombre_tecleado: 'Madre Ensayo',
      p_ip_address: null,
      p_user_agent: 'ensayo',
    })
    return resultado(error)
  }
  async function ruta(u: TestUser, version: string, nino: string): Promise<string> {
    const { data, error } = await (
      await como(u)
    ).rpc('ruta_version_documento_nino', {
      p_version_id: version,
      p_nino_id: nino,
    })
    return error ? resultado(error) : `…${data!.slice(-8)}`
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Firmar Documentos')
    fuera = await createTestCentro('Otro Centro Firmar Documentos')
    cursoActivo = (await createTestCurso(centro.id, 'activo')).id
    cursoPlan = (await createTestCurso(centro.id, 'planificado')).id
    admin = await createTestUser({ nombre: 'Admin Firmar Documentos' })
    directora = await createTestUser({ nombre: 'Directora Firmar Documentos' })
    superU = await createTestUser({ nombre: 'Superusuario Firmar Documentos' })
    profe = await createTestUser({ nombre: 'Profe Firmar Documentos' })
    madre = await createTestUser({ nombre: 'Madre Firmar Documentos' })
    padre = await createTestUser({ nombre: 'Padre Firmar Documentos' })
    autorizada = await createTestUser({ nombre: 'Autorizada Firmar Documentos' })
    otra = await createTestUser({ nombre: 'Otra Madre Firmar Documentos' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    const { error: e } = await serviceClient
      .from('platform_admins')
      .insert({ usuario_id: superU.id })
    if (e) throw new Error(`sembrar superusuario: ${e.message}`)

    // Lucía: matriculada en el curso activo (en el aula de la profe) y en el planificado: le tocan
    // dos presupuestos. Íñigo, hijo de la misma madre, sin matrícula: no le toca nada. Pablo, con el
    // alta pendiente. Ajeno, de otro centro.
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    inigo = (await createTestNino(centro.id, 'Íñigo')).id
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    ajeno = (await createTestNino(fuera.id, 'Ajeno')).id
    const aula = await createTestAula(centro.id, cursoActivo)
    const aulaPlan = await createTestAula(centro.id, cursoPlan)
    await matricular(lucia, aula.id, cursoActivo)
    await matricular(lucia, aulaPlan.id, cursoPlan)
    await asignarProfeAula(profe.id, aula.id, cursoActivo)
    const mp = await matricular(pablo, aula.id, cursoActivo)
    const { error: ep } = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', mp)
    if (ep) throw new Error(`matrícula pendiente: ${ep.message}`)
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    await crearVinculo(lucia, padre.id, 'tutor_legal_secundario')
    await crearVinculo(lucia, autorizada.id, 'autorizado')
    await crearVinculo(inigo, madre.id, 'tutor_legal_principal')
    await crearVinculo(pablo, madre.id, 'tutor_legal_principal')

    const sesion = await como(admin)
    const crea = async (titulo: string, deCurso: boolean, orden: number) => {
      const { data, error } = await sesion.rpc('crear_documento_centro', {
        p_centro_id: centro.id,
        p_titulo: titulo,
        p_de_curso: deCurso,
        p_obligatorio: true,
        p_orden: orden,
      })
      if (error || !data) throw new Error(`crear documento: ${error?.message}`)
      return data
    }
    presupuesto = await crea('Presupuesto', true, 1)
    normas = await crea('Normas', false, 2)
    await crea('Sin subir', false, 3)
    // Solo el del curso activo: el del planificado todavía no existe.
    pActivo1 = await sube(presupuesto, cursoActivo, 'presupuesto activo v1')
    normas1 = await sube(normas, null, 'normas v1')
  })

  afterAll(async () => {
    if (!centro) return
    const id = centro.id
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
    if (superU) await serviceClient.from('platform_admins').delete().eq('usuario_id', superU.id)
    await deleteTestCentro(id)
    if (fuera) await deleteTestCentro(fuera.id)
    for (const u of [admin, directora, superU, profe, madre, padre, autorizada, otra])
      if (u) await deleteTestUser(u.id)
  })

  it('premisas: quién es quién, y que nadie ha firmado nada', async () => {
    const pregunta = async (u: TestUser, f: string, args: Record<string, string>) => {
      const { data, error } = await (await como(u)).rpc(f as never, args as never)
      return error ? `error ${error.code}` : String(data)
    }
    expect
      .soft(await pregunta(madre, 'es_tutor_legal_de', { p_nino_id: lucia }), 'madre')
      .toBe('true')
    expect
      .soft(await pregunta(padre, 'es_tutor_legal_de', { p_nino_id: lucia }), 'padre')
      .toBe('true')
    // La autorizada ES de la familia (es_tutor_de) y NO es tutora legal: la regla la deja fuera a ella.
    expect.soft(await pregunta(autorizada, 'es_tutor_de', { p_nino_id: lucia }), 'aut').toBe('true')
    expect
      .soft(await pregunta(autorizada, 'es_tutor_legal_de', { p_nino_id: lucia }), 'aut legal')
      .toBe('false')
    expect
      .soft(await pregunta(profe, 'es_profe_de_nino', { p_nino_id: lucia }), 'profe')
      .toBe('true')
    expect
      .soft(await pregunta(superU, 'es_admin', { p_centro_id: centro.id }), 'super admin')
      .toBe('true')
    expect
      .soft(await pregunta(directora, 'es_admin', { p_centro_id: centro.id }), 'dir')
      .toBe('true')
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.firmas_documentos_centro WHERE centro_id = '${centro.id}';`
      ).salida
    ).toBe('0')
  })

  it('lo que le toca a Lucía: dos presupuestos (uno por curso), las normas y lo que no existe', async () => {
    // El orden de dos cursos depende de su nombre: se compara como conjunto.
    expect((await estados(madre, lucia)).split(', ').sort()).toEqual(
      [
        `Presupuesto/${nombreCurso(cursoActivo)}=por_firmar`,
        `Presupuesto/${nombreCurso(cursoPlan)}=falta_documento`,
        'Normas=por_firmar',
        'Sin subir=falta_documento',
      ].sort()
    )
    // Íñigo no tiene matrícula viva: no le toca nada.
    expect(await estados(madre, inigo)).toBe('')
  })

  it('leen sus tutores legales y Dirección; la autorizada, la profe, otra familia y sin sesión, no', async () => {
    // Control positivo delante: la admin y la directora sí.
    for (const u of [madre, padre, admin, directora, superU])
      expect.soft(await estados(u, lucia), u.email).toContain('Normas=por_firmar')
    for (const u of [autorizada, profe, otra])
      expect.soft(await estados(u, lucia), u.email).toBe('42501')
  })

  it('firma con el dedo el tutor legal, una vez por niño (J3); nadie más', async () => {
    for (const u of [otra, autorizada, profe, admin])
      expect.soft(await firma(u, pActivo1, lucia), u.email).toBe('42501')
    // Control: la madre firma, y queda su nombre sin espacios, su IP y su método.
    expect(await firma(madre, pActivo1, lucia)).toBe('ok')
    const fila =
      comoPostgres(`SELECT metodo_firma || '/' || rol_firmante || '/' || nombre_tecleado || '/' || host(ip_address)
      FROM public.firmas_documentos_centro WHERE nino_id = '${lucia}';`)
    expect(fila.salida).toBe('digital/tutor_legal_principal/Madre Ensayo/203.0.113.7')
    expect.soft(await firma(madre, pActivo1, lucia), 'otra vez').toBe('P0001 ya_firmado')
    expect.soft(await firma(padre, pActivo1, lucia), 'J3, el padre').toBe('P0001 ya_firmado')
    // Lo que no le toca: un niño sin matrícula y uno de otro centro.
    expect.soft(await firma(madre, normas1, inigo), 'Íñigo').toBe('P0001 version_no_vigente')
    expect.soft(await firma(madre, normas1, ajeno), 'ajeno').toBe('42501')
  })

  it('J4: una versión corregida no reabre lo firmado, y la vieja ya no se firma', async () => {
    await sube(presupuesto, cursoActivo, 'presupuesto activo v2 corregida')
    const normas2 = await sube(normas, null, 'normas v2')
    expect(await estados(madre, lucia)).toContain(`Presupuesto/${nombreCurso(cursoActivo)}=firmado`)
    expect.soft(await firma(madre, normas1, lucia), 'normas v1').toBe('P0001 version_no_vigente')
    // Control: la vigente sí.
    expect(await firma(madre, normas2, lucia)).toBe('ok')
    expect(await estados(madre, lucia)).toContain('Normas=firmado')
  })

  it('en persona la registra Dirección, sin trazo; el superusuario no, ni la familia', async () => {
    const v = await sube(presupuesto, cursoPlan, 'presupuesto planificado v1')
    for (const u of [superU, madre, profe])
      expect.soft(await presencial(u, v, lucia), u.email).toBe('42501')
    // Control: la directora sí, y queda como quien la registra, con rol admin y sin trazo.
    expect(await presencial(directora, v, lucia)).toBe('ok')
    const fila =
      comoPostgres(`SELECT metodo_firma || '/' || rol_firmante || '/' || (firma_imagen IS NULL) || '/' || (firmante_id = '${directora.id}')
      FROM public.firmas_documentos_centro WHERE version_id = '${v}';`)
    expect(fila.salida).toBe('presencial/admin/true/true')
  })

  it('el PDF: el que le toca o el que firmó, y nada más', async () => {
    expect
      .soft(await ruta(madre, pActivo1, lucia), 'el que firmó')
      .toBe(`…${sha(pdf('presupuesto activo v1')).slice(-4)}.pdf`)
    expect.soft(await ruta(madre, normas1, lucia), 'normas v1, ni toca ni firmó').toBe('42501')
    expect.soft(await ruta(otra, pActivo1, lucia), 'otra familia').toBe('42501')
    expect.soft(await ruta(autorizada, pActivo1, lucia), 'la autorizada').toBe('42501')
    expect.soft(await ruta(admin, pActivo1, lucia), 'Dirección (control)').toMatch(/\.pdf$/)
  })

  it('la lista del centro es de Dirección y solo trae lo pendiente', async () => {
    const lista = async (u: TestUser, c: string | null) => {
      const { data, error } = await (
        await como(u)
      ).rpc('documentos_firma_centro', {
        p_centro_id: c as string,
      })
      return error ? resultado(error) : data!
    }
    const deAdmin = await lista(admin, centro.id)
    expect(Array.isArray(deAdmin)).toBe(true)
    const filas = deAdmin as { nino_id: string; titulo: string; estado: string }[]
    // Premisa: trae a Pablo (todo por firmar) y nada firmado.
    expect.soft(filas.some((f) => f.nino_id === pablo && f.estado === 'por_firmar')).toBe(true)
    expect.soft(filas.every((f) => f.estado !== 'firmado')).toBe(true)
    // De Lucía solo queda «Sin subir», que no existe: no es de la familia.
    expect
      .soft(filas.filter((f) => f.nino_id === lucia).map((f) => `${f.titulo}=${f.estado}`))
      .toEqual(['Sin subir=falta_documento'])
    for (const [u, c] of [
      [profe, centro.id],
      [madre, centro.id],
      [admin, null],
    ] as const)
      expect.soft(await lista(u, c), `${u.email} ${c}`).toBe('42501')
  })

  it('U-3 en la base: el alta se cierra con el acuse médico de ESE niño, no con el de otro', async () => {
    const acuse = async (nino: string) => {
      const { error } = await serviceClient.from('consentimientos').insert({
        usuario_id: madre.id,
        tipo: 'datos_medicos',
        version: 'v2.0',
        metodo_firma: 'digital',
        nino_id: nino,
      })
      if (error) throw new Error(`acuse: ${error.message}`)
    }
    await acuse(lucia)
    // Premisa: la madre tiene un acuse médico vigente (el de Lucía) y Pablo sigue pendiente.
    expect(
      comoPostgres(`SELECT (SELECT count(*) FROM public.consentimientos WHERE usuario_id = '${madre.id}' AND tipo = 'datos_medicos' AND revocado_en IS NULL)
        || '/' || (SELECT estado FROM public.matriculas WHERE nino_id = '${pablo}');`).salida
    ).toBe('1/pendiente')
    const cierra = async () => {
      const { data, error } = await (
        await como(madre)
      ).rpc('marcar_matricula_lista', {
        p_nino_id: pablo,
      })
      return error ? resultado(error) : data ? 'lista' : 'null'
    }
    expect(await cierra()).toBe('42501')
    // Control: con el acuse de Pablo, cierra. Desde el 4b-2 (`20270109120000`) el cierre pide también
    // los documentos obligatorios firmados: la madre firma los dos de Pablo, para que el control mida
    // solo el acuse. (Lo de la puerta de los documentos: `alta-cierra-documentos.rls.test.ts`.)
    await acuse(pablo)
    for (const v of [pActivo1, normas1]) expect(await firma(madre, v, pablo)).toBe('ok')
    expect(await cierra()).toBe('lista')
  })
})

/** El nombre de un curso de test, leído de la base (lo pone `createTestCurso`). */
const nombres = new Map<string, string>()
function nombreCurso(id: string): string {
  if (!nombres.has(id)) {
    const r = comoPostgres(`SELECT nombre FROM public.cursos_academicos WHERE id = '${id}';`)
    if (!r.ok) throw new Error(r.salida)
    nombres.set(id, r.salida)
  }
  return nombres.get(id)!
}
