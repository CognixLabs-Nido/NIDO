import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { leerDocumentosAlta } from '@/features/alta/lib/documentos-alta'
import { frenaElAlta } from '@/features/alta/lib/regla-documentos-alta'
import type { Database } from '@/types/database'

import {
  borrarDocumentosDe,
  comoPostgres,
  creaDocumento,
  subeVersion,
} from './documentos-centro-fixture'
import {
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

/**
 * El alta se cierra con los documentos del centro firmados (fase 4, 4b-2; `20270109120000`), contra
 * la BD y el Storage del CI. Decisiones del 2026-11-06 (`docs/specs/altas-serie.md`):
 *  - un documento OBLIGATORIO por firmar frena el cierre, también a la Dirección;
 *  - uno que el centro no ha subido no frena (P-6), ni uno opcional: hasta que el centro suba las
 *    normas, el alta se cierra sin normas;
 *  - la app (`leerDocumentosAlta` + `frenaElAlta`, lo que hace `finalizarAlta`) y la base
 *    (`marcar_matricula_lista`) dicen lo mismo de cada niño;
 *  - la casilla de las normas (`acuses_alta`) ya no cuenta.
 *
 * Centro 1: Normas (obligatorio, subido), Sin subir (obligatorio) y Opcional (subido).
 * Centro 2: solo Sin subir (obligatorio). Cada niño, su alta pendiente y el acuse médico de quien
 * cierra, para que lo único que decida sea lo de los documentos. Fixtures ficticios, del 2026-11-06.
 */
type Cliente = SupabaseClient<Database>

describe('El cierre del alta y los documentos del centro (4b-2)', () => {
  let centro: TestCentro
  let centro2: TestCentro
  let admin: TestUser
  let admin2: TestUser
  let tutora: TestUser
  let normasV1: string
  // ana: nada firmado. bea: las normas firmadas. carla (centro 2): nada subido. dani: la casilla de
  // antes y nada firmado.
  const n: Record<'ana' | 'bea' | 'carla' | 'dani', string> = {
    ana: '',
    bea: '',
    carla: '',
    dani: '',
  }

  const sesiones = new Map<string, Cliente>()
  const como = async (u: TestUser): Promise<Cliente> => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  const cierra = async (u: TestUser, nino: string): Promise<string> => {
    const { data, error } = await (await como(u)).rpc('marcar_matricula_lista', { p_nino_id: nino })
    if (error) return error.hint ? `${error.code} ${error.hint}` : String(error.code)
    return data ? 'lista' : 'null'
  }
  const estados = async (nino: string): Promise<string> => {
    const r = await leerDocumentosAlta(await como(tutora), nino)
    if (!r.ok) throw new Error(r.error)
    return r.data.map((d) => `${d.titulo}=${d.estado}`).join(', ')
  }
  const acuseMedico = async (u: TestUser, nino: string) => {
    const { error } = await serviceClient.from('consentimientos').insert({
      usuario_id: u.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
      nino_id: nino,
    })
    if (error) throw new Error(`acuse médico: ${error.message}`)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cierre Documentos')
    centro2 = await createTestCentro('Centro Cierre Documentos Dos')
    admin = await createTestUser({ nombre: 'Admin Cierre' })
    admin2 = await createTestUser({ nombre: 'Admin Cierre Dos' })
    tutora = await createTestUser({ nombre: 'Tutora Cierre' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(admin2.id, centro2.id, 'admin')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await asignarRol(tutora.id, centro2.id, 'tutor_legal')

    // Un curso activo y un aula por centro (un solo curso activo por centro).
    const aulas = new Map<string, { curso: string; aula: string }>()
    for (const c of [centro, centro2]) {
      const curso = (await createTestCurso(c.id)).id
      aulas.set(c.id, { curso, aula: (await createTestAula(c.id, curso)).id })
    }
    for (const [k, c] of [
      ['ana', centro],
      ['bea', centro],
      ['carla', centro2],
      ['dani', centro],
    ] as const) {
      const { curso, aula } = aulas.get(c.id)!
      n[k] = (await createTestNino(c.id, `${k} Cierre`)).id
      const m = await matricular(n[k], aula, curso)
      const { error } = await serviceClient
        .from('matriculas')
        .update({ estado: 'pendiente' })
        .eq('id', m)
      if (error) throw new Error(`matrícula pendiente: ${error.message}`)
      await crearVinculo(n[k], tutora.id, 'tutor_legal_principal')
      await acuseMedico(tutora, n[k])
    }
    await acuseMedico(admin, n.ana)

    const s1 = await como(admin)
    const normas = await creaDocumento(s1, centro.id, 'Normas', { orden: 1 })
    await creaDocumento(s1, centro.id, 'Sin subir', { orden: 2 })
    const opcional = await creaDocumento(s1, centro.id, 'Opcional', {
      obligatorio: false,
      orden: 3,
    })
    normasV1 = await subeVersion(s1, centro.id, normas, null, 'normas v1')
    await subeVersion(s1, centro.id, opcional, null, 'opcional v1')
    await creaDocumento(await como(admin2), centro2.id, 'Sin subir', { orden: 1 })

    // Bea firma las normas antes de cerrar; Dani tiene la casilla de antes del 4b-2 (histórico).
    const { error: ef } = await (
      await como(tutora)
    ).rpc('firmar_documento_centro', {
      p_version_id: normasV1,
      p_nino_id: n.bea,
      p_nombre_tecleado: 'Tutora Cierre',
      p_firma_imagen: 'data:image/png;base64,AAAA',
      p_ip_address: null,
      p_user_agent: null as unknown as string,
    })
    if (ef) throw new Error(`firmar lo de Bea: ${ef.message}`)
    const { error: ea } = await serviceClient.from('acuses_alta').insert({
      nino_id: n.dani,
      centro_id: centro.id,
      tipo: 'normas',
      firmante_id: tutora.id,
    })
    if (ea) throw new Error(`la casilla de antes: ${ea.message}`)
  })

  afterAll(async () => {
    for (const c of [centro, centro2]) if (c) await borrarDocumentosDe(c.id)
    if (centro) await deleteTestCentro(centro.id)
    if (centro2) await deleteTestCentro(centro2.id)
    for (const u of [admin, admin2, tutora]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: lo que le toca a cada niño, y las cuatro altas pendientes', async () => {
    expect(await estados(n.ana)).toBe(
      'Normas=por_firmar, Sin subir=falta_documento, Opcional=por_firmar'
    )
    expect(await estados(n.bea)).toBe(
      'Normas=firmado, Sin subir=falta_documento, Opcional=por_firmar'
    )
    expect(await estados(n.carla)).toBe('Sin subir=falta_documento')
    expect(await estados(n.dani)).toBe(
      'Normas=por_firmar, Sin subir=falta_documento, Opcional=por_firmar'
    )
    const pendientes = comoPostgres(`SELECT count(*) FROM public.matriculas
      WHERE nino_id IN ('${n.ana}', '${n.bea}', '${n.carla}', '${n.dani}') AND estado = 'pendiente';`)
    expect(pendientes).toBe('4')
  })

  it('la app y la base dicen lo mismo de cada niño: frena el obligatorio por firmar, y solo él', async () => {
    const app: Record<string, boolean> = {}
    for (const k of ['ana', 'bea', 'carla'] as const) {
      const r = await leerDocumentosAlta(await como(tutora), n[k])
      if (!r.ok) throw new Error(r.error)
      app[k] = r.data.some(frenaElAlta)
    }
    expect(app).toEqual({ ana: true, bea: false, carla: false })
    // La base, después de la app: Bea (firmado, con uno sin subir y uno opcional pendientes) y Carla
    // (solo uno sin subir) cierran; Ana no.
    expect(await cierra(tutora, n.ana)).toBe('P0001 documentos_por_firmar')
    expect(await cierra(tutora, n.bea)).toBe('lista')
    expect(await cierra(tutora, n.carla)).toBe('lista')
  })

  it('la Dirección tampoco cierra con un obligatorio por firmar; en persona lo firma, y cierra', async () => {
    expect(await cierra(admin, n.ana)).toBe('P0001 documentos_por_firmar')
    const { error } = await (
      await como(admin)
    ).rpc('registrar_firma_documento_presencial', {
      p_version_id: normasV1,
      p_nino_id: n.ana,
      p_nombre_tecleado: 'Tutora Cierre',
      p_ip_address: null,
      p_user_agent: null as unknown as string,
    })
    expect(error).toBeNull()
    expect(await estados(n.ana)).toBe(
      'Normas=firmado, Sin subir=falta_documento, Opcional=por_firmar'
    )
    expect(await cierra(admin, n.ana)).toBe('lista')
  })

  it('la casilla de las normas de antes ya no cuenta: con ella y sin firma, no cierra', async () => {
    // Premisa: Dani tiene su fila de normas en `acuses_alta`, la que el gate de antes daba por buena.
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.acuses_alta WHERE nino_id = '${n.dani}' AND tipo = 'normas';`
      )
    ).toBe('1')
    expect(await cierra(tutora, n.dani)).toBe('P0001 documentos_por_firmar')
  })
})
