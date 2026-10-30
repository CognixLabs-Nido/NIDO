import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { recolectarNino } from '@/features/export/lib/recolectar'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * El expediente por tiempo (F11-B, punto 6, PR-6; 20261204120000).
 *
 * Terminado el curso de la baja, la ficha médica queda bloqueada para todos: ni se lee (sin dejar
 * lectura), ni se escribe, ni da el aviso del aula, y el export dice que existe y está bloqueada sin
 * entregarla. Reincorporar al niño la desbloquea. A los años del plazo desde la baja, la purga del
 * niño, la misma que la del olvido.
 *
 * Lo viejo es de un curso de 1995-96 y la purga se pide con 20 años: así solo alcanza a lo de este
 * fichero aunque la BD la compartan otros tests. El curso de ahora termina en 2099, para que «aún
 * no ha terminado» no dependa del día en que corra el test.
 */

const ANIOS = 20
const BLOQUEADA_DESDE = '1996-08-01' // el día siguiente al final del curso 1995-96

const FICHA = {
  p_alergias_graves: 'Frutos secos',
  p_notas_emergencia: 'Llamar a la madre',
  p_medicacion_habitual: 'Ninguna',
  p_alergias_leves: '',
  p_medico_familia: 'Dra. Demo',
  p_telefono_emergencia: '600000000',
}

describe('Retención del expediente', () => {
  let centro: { id: string }
  let admin: TestUser
  let aula: string
  /** De baja en 1996: ficha bloqueada y expediente vencido. */
  let vencido: string
  /** De baja hoy: ni bloqueada ni vencido. */
  let reciente: string
  /** De baja en 1996 y reincorporado. */
  let vuelve: string
  /** Archivado en 1996 pero con su matrícula dada de baja ahora: cuenta la fecha más tardía. */
  let bajaTardia: string

  async function archivar(nino: string, fechaBaja: string, archivadoEn?: string) {
    const c = await clientFor(admin)
    const { error } = await c.rpc('archivar_nino', { p_nino_id: nino, p_fecha_baja: fechaBaja })
    expect(error).toBeNull()
    if (archivadoEn) {
      const { error: e2 } = await serviceClient
        .from('ninos')
        .update({ deleted_at: `${archivadoEn}T10:00:00+00:00` })
        .eq('id', nino)
      expect(e2).toBeNull()
    }
  }

  async function lecturas(nino: string): Promise<number> {
    const { count, error } = await serviceClient
      .from('lecturas_ficha_medica')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', nino)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function leer(nino: string) {
    const c = await clientFor(admin)
    return c.rpc('get_info_medica_emergencia', { p_nino_id: nino, p_origen: 'ficha' })
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Expediente')
    admin = await createTestUser({ nombre: 'Admin Retencion Expediente' })
    await asignarRol(admin.id, centro.id, 'admin')

    const viejo = (await createTestCurso(centro.id, 'cerrado')).id
    const r1 = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_inicio: '1995-09-01', fecha_fin: '1996-07-31' })
      .eq('id', viejo)
    expect(r1.error).toBeNull()
    const actual = (await createTestCurso(centro.id)).id
    const r2 = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_fin: '2099-07-31' })
      .eq('id', actual)
    expect(r2.error).toBeNull()
    aula = (await createTestAula(centro.id, actual)).id

    vencido = (await createTestNino(centro.id, 'Nino Expediente Vencido')).id
    reciente = (await createTestNino(centro.id, 'Nino Expediente Reciente')).id
    vuelve = (await createTestNino(centro.id, 'Nino Expediente Vuelve')).id
    bajaTardia = (await createTestNino(centro.id, 'Nino Expediente Baja Tardia')).id

    const c = await clientFor(admin)
    for (const n of [vencido, reciente, vuelve, bajaTardia]) {
      const { error } = await c.rpc('set_info_medica_emergencia_cifrada', {
        p_nino_id: n,
        ...FICHA,
      })
      expect(error).toBeNull()
    }
    const { error: aErr } = await serviceClient
      .from('agendas_diarias')
      .insert({ nino_id: vencido, fecha: '1996-03-01', observaciones_generales: 'obs' })
    expect(aErr).toBeNull()

    await matricular(bajaTardia, aula, actual)

    await archivar(vencido, '1996-03-01', '1996-03-01')
    await archivar(vuelve, '1996-03-01', '1996-03-01')
    await archivar(reciente, new Date().toISOString().slice(0, 10))
    await archivar(bajaTardia, hoyMadrid(), '1996-03-01')
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  it('premisa: los cuatro de baja, con su ficha y el curso viejo terminado', async () => {
    const { data, error } = await serviceClient
      .from('ninos')
      .select('id, deleted_reason')
      .in('id', [vencido, reciente, vuelve, bajaTardia])
    expect(error).toBeNull()
    expect(data!.map((n) => n.deleted_reason)).toEqual(Array(4).fill('baja_nino'))
    const { count } = await serviceClient
      .from('info_medica_emergencia')
      .select('id', { count: 'exact', head: true })
      .in('nino_id', [vencido, reciente, vuelve, bajaTardia])
    expect(count).toBe(4)
  })

  it('bloqueada: nadie la lee, ni Dirección, y la lectura no queda registrada', async () => {
    const antes = await lecturas(vencido)
    const { data, error } = await leer(vencido)
    expect(data).toBeNull()
    expect(error?.code).toBe('55000')
    expect(error?.details).toBe(BLOQUEADA_DESDE)
    expect(await lecturas(vencido)).toBe(antes)
  })

  it('bloqueada: Dirección no la escribe, por ninguno de sus dos setters', async () => {
    const c = await clientFor(admin)
    const dir = await c.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: vencido,
      ...FICHA,
    })
    expect(dir.error?.code).toBe('55000')
    const tut = await c.rpc('set_info_medica_emergencia_cifrada_tutor', {
      p_nino_id: vencido,
      ...FICHA,
    })
    expect(tut.error?.code).toBe('55000')
  })

  it('bloqueada: de ella no sale el aviso del aula; de la que no lo está, sí', async () => {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('alertas_medicas', { p_nino_ids: [vencido, reciente] })
    expect(error).toBeNull()
    expect(data!.map((a) => a.nino_id)).toEqual([reciente])
  })

  it('el export no la entrega, pero dice que existe, que está bloqueada, desde cuándo y cómo pedirla', async () => {
    const antes = await lecturas(vencido)
    const rec = await recolectarNino(await clientFor(admin), serviceClient, vencido)
    const med = rec!.data.info_medica_emergencia as Record<string, unknown>
    expect(med.bloqueada_desde).toBe(BLOQUEADA_DESDE)
    expect(med._nota).toContain('Existe información médica')
    expect(med._nota).toContain('BLOQUEADA desde el 01/08/1996')
    expect(med._nota).toContain('pídela por escrito')
    expect(med).not.toHaveProperty('alergias_graves')
    expect(await lecturas(vencido)).toBe(antes)
  })

  it('de baja hoy, el curso no ha terminado: Dirección la lee, y queda registrado', async () => {
    const antes = await lecturas(reciente)
    const { data, error } = await leer(reciente)
    expect(error).toBeNull()
    expect(data![0]!.alergias_graves).toBe('Frutos secos')
    expect(await lecturas(reciente)).toBe(antes + 1)
  })

  it('cuenta la fecha más tardía de la baja: archivado en 1996 con la matrícula dada de baja ahora', async () => {
    const { error } = await leer(bajaTardia)
    expect(error).toBeNull()
    const { data } = await serviceClient.rpc('expedientes_vencidos', { p_anios: ANIOS })
    expect(data!.map((v) => v.nino_id)).not.toContain(bajaTardia)
  })

  it('reincorporarlo la desbloquea', async () => {
    const bloqueada = await leer(vuelve)
    expect(bloqueada.error?.code).toBe('55000')
    const c = await clientFor(admin)
    const { error: dErr } = await c.rpc('desarchivar_nino', { p_nino_id: vuelve, p_aula_id: aula })
    expect(dErr).toBeNull()
    const { data, error } = await leer(vuelve)
    expect(error).toBeNull()
    expect(data![0]!.alergias_graves).toBe('Frutos secos')
  })

  it('solo service_role lista y purga expedientes', async () => {
    const c = await clientFor(admin)
    const lista = await c.rpc('expedientes_vencidos', { p_anios: ANIOS })
    expect(lista.error?.code).toBe('42501')
    const purga = await c.rpc('purgar_expediente_nino', { p_nino_id: vencido, p_anios: ANIOS })
    expect(purga.error?.code).toBe('42501')
    const malo = await serviceClient.rpc('expedientes_vencidos', { p_anios: 0 })
    expect(malo.error?.code).toBe('22023')
  })

  it('a los años del plazo, la purga del niño: la del olvido, con su actor', async () => {
    const { data: lista, error } = await serviceClient.rpc('expedientes_vencidos', {
      p_anios: ANIOS,
    })
    expect(error).toBeNull()
    const ids = lista!.map((v) => v.nino_id)
    expect(ids).toContain(vencido)
    expect(ids).not.toContain(reciente)
    expect(ids).not.toContain(vuelve)
    expect(lista!.find((v) => v.nino_id === vencido)!.centro_id).toBe(centro.id)

    // El que no ha vencido no se purga aunque se pida.
    const no = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: reciente,
      p_anios: ANIOS,
    })
    expect(no.error).toBeNull()
    expect(no.data).toBe(false)

    // Las copias del niño de antes de la purga: las de después son las que escribe ella.
    const { data: previas } = await serviceClient
      .from('audit_log')
      .select('id')
      .eq('tabla', 'ninos')
      .eq('registro_id', vencido)
    const idsPrevias = previas!.map((p) => p.id)
    expect(idsPrevias.length).toBeGreaterThan(0)

    const si = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: vencido,
      p_anios: ANIOS,
    })
    expect(si.error).toBeNull()
    expect(si.data).toBe(true)

    const { data: n } = await serviceClient
      .from('ninos')
      .select('nombre, deleted_reason')
      .eq('id', vencido)
      .single()
    expect(n).toEqual({ nombre: '[borrado]', deleted_reason: 'purga_rgpd' })
    const { data: m } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves, telefono_emergencia')
      .eq('nino_id', vencido)
      .single()
    expect(m).toEqual({ alergias_graves: null, telefono_emergencia: null })
    const { count: agendas } = await serviceClient
      .from('agendas_diarias')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', vencido)
    expect(agendas).toBe(0)
    const { data: copias } = await serviceClient
      .from('audit_log')
      .select('actor_sistema')
      .eq('tabla', 'ninos')
      .eq('registro_id', vencido)
      .not('id', 'in', `(${idsPrevias.join(',')})`)
    expect(copias!.length).toBeGreaterThan(0)
    expect(new Set(copias!.map((c) => c.actor_sistema))).toEqual(
      new Set(['system:purgar_expediente_vencido'])
    )

    // Purgado, ya no está de baja: no vuelve a la lista ni se purga dos veces.
    const { data: despues } = await serviceClient.rpc('expedientes_vencidos', { p_anios: ANIOS })
    expect(despues!.map((v) => v.nino_id)).not.toContain(vencido)
    const otra = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: vencido,
      p_anios: ANIOS,
    })
    expect(otra.data).toBe(false)

    // El de baja hoy sigue entero.
    const { data: r } = await serviceClient
      .from('ninos')
      .select('nombre, deleted_reason')
      .eq('id', reciente)
      .single()
    expect(r).toEqual({ nombre: 'Nino Expediente Reciente', deleted_reason: 'baja_nino' })
  })

  // PR-A2 (20261210120000): la purga también bloquea la ficha. Antes, con el niño purgado ya no
  // estaba «de baja», el predicado daba NULL y Dirección leía la ficha vaciada, dejando su fila en
  // el registro, y podía volver a escribirla. Sigue al test anterior, que purga a `vencido`.
  it('purgado, la ficha queda bloqueada desde la purga: ni se lee, ni deja lectura, ni se escribe', async () => {
    const { data: n, error: nErr } = await serviceClient
      .from('ninos')
      .select('deleted_reason, purgado_en')
      .eq('id', vencido)
      .single()
    expect(nErr).toBeNull()
    // Premisa: purgado, con su fecha; ya no es un niño «de baja».
    expect(n!.deleted_reason).toBe('purga_rgpd')
    expect(n!.purgado_en).not.toBeNull()
    // La fecha de la purga es la de Madrid: se fija a una hora en que el día UTC aún es el 14.
    const { error: fijarErr } = await serviceClient
      .from('ninos')
      .update({ purgado_en: '2026-06-14T22:30:00Z' })
      .eq('id', vencido)
    expect(fijarErr).toBeNull()
    const desde = '2026-06-15'

    const antes = await lecturas(vencido)
    const { data, error } = await leer(vencido)
    expect(data).toBeNull()
    expect(error?.code).toBe('55000')
    expect(error?.details).toBe(desde)
    expect(await lecturas(vencido)).toBe(antes)

    const c = await clientFor(admin)
    const dir = await c.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: vencido,
      ...FICHA,
    })
    expect(dir.error?.code).toBe('55000')
    const { data: m } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves')
      .eq('nino_id', vencido)
      .single()
    expect(m!.alergias_graves).toBeNull()

    // El de baja hoy sigue dando su aviso: no es que la consulta no devuelva nada.
    const avisos = await c.rpc('alertas_medicas', { p_nino_ids: [vencido, reciente] })
    expect(avisos.error).toBeNull()
    expect(avisos.data!.map((a) => a.nino_id)).toEqual([reciente])
  })
})
