import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Quién ha leído la ficha médica (`20261128120000`, docs/specs/ficha-medica-lecturas.md).
 *
 * Cada lectura autorizada de `get_info_medica_emergencia` deja una fila con quién, por qué pudo,
 * desde dónde y qué campos vio; una no autorizada no deja nada. La tabla de la ficha ya no se lee
 * con sesión: las listas usan `alertas_medicas`. El registro lo leen los tutores legales y la
 * Dirección (también con el niño de baja y el vínculo cerrado, y entonces solo ella), sale en el
 * export del niño, la purga del niño lo borra y el plazo borra lo vencido.
 */

type Sesion = SupabaseClient<Database>
type Args = Database['public']['Functions']['set_info_medica_emergencia_cifrada']['Args']

describe('Lecturas de la ficha médica', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let nino: TestNino
  let ninoSinFicha: TestNino
  let ninoOtroCentro: TestNino
  let titular: TestUser
  let directora: TestUser
  let profe: TestUser
  let tutor1: TestUser
  let tutor2: TestUser
  let autorizado: TestUser
  let sinPermiso: TestUser
  let titularOtro: TestUser
  const usuarios: TestUser[] = []
  const s: Record<string, Sesion> = {}

  async function lecturasDe(ninoId: string) {
    const { data, error } = await serviceClient
      .from('lecturas_ficha_medica')
      .select('lector_id, rol_lector, origen, campos, centro_id')
      .eq('nino_id', ninoId)
      .order('leida_en')
    if (error) throw new Error(`lecturas: ${error.message}`)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Lecturas Ficha')
    otroCentro = await createTestCentro('Otro Centro Lecturas')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id, 'Aula Lecturas')
    nino = await createTestNino(centro.id, 'Niño Demo Ficha')
    ninoSinFicha = await createTestNino(centro.id, 'Niño Demo Sin Ficha')
    ninoOtroCentro = await createTestNino(otroCentro.id, 'Niño Demo Otro Centro')
    await matricular(nino.id, aula.id, curso.id)
    await matricular(ninoSinFicha.id, aula.id, curso.id)

    titular = await createTestUser({ nombre: 'Titular Lecturas' })
    directora = await createTestUser({ nombre: 'Directora Lecturas' })
    profe = await createTestUser({ nombre: 'Profe Lecturas' })
    tutor1 = await createTestUser({ nombre: 'Tutora Lecturas Uno' })
    tutor2 = await createTestUser({ nombre: 'Tutor Lecturas Dos' })
    autorizado = await createTestUser({ nombre: 'Autorizado Lecturas' })
    sinPermiso = await createTestUser({ nombre: 'Autorizado Sin Permiso' })
    titularOtro = await createTestUser({ nombre: 'Titular Otro Centro' })
    usuarios.push(titular, directora, profe, tutor1, tutor2, autorizado, sinPermiso, titularOtro)

    await asignarRol(titular.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    await asignarRol(titularOtro.id, otroCentro.id, 'admin')
    for (const u of [tutor1, tutor2]) await asignarRol(u.id, centro.id, 'tutor_legal')
    for (const u of [autorizado, sinPermiso]) await asignarRol(u.id, centro.id, 'autorizado')
    await crearVinculo(nino.id, tutor1.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    await crearVinculo(nino.id, tutor2.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', { puede_ver_info_medica: true })
    await crearVinculo(nino.id, sinPermiso.id, 'autorizado', { puede_ver_info_medica: false })

    for (const [k, u] of Object.entries({
      titular,
      directora,
      profe,
      tutor1,
      tutor2,
      autorizado,
      sinPermiso,
      titularOtro,
    }))
      s[k] = await clientFor(u)

    // Dos de los seis campos con contenido: el registro dice esos dos.
    for (const n of [nino, ninoOtroCentro]) {
      const quien = n === nino ? s.titular! : s.titularOtro!
      const { error } = await quien.rpc('set_info_medica_emergencia_cifrada', {
        p_nino_id: n.id,
        p_alergias_graves: 'Frutos secos',
        p_medicacion_habitual: 'Ventolín',
        p_notas_emergencia: null,
        p_alergias_leves: null,
        p_medico_familia: null,
        p_telefono_emergencia: null,
      } as unknown as Args)
      if (error) throw new Error(`ficha: ${error.message}`)
    }
  }, 120_000)

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  it('cada vía de lectura deja su fila: quién, por qué, desde dónde y qué campos', async () => {
    // Premisa: aún no hay lecturas.
    expect(await lecturasDe(nino.id)).toHaveLength(0)

    const casos: Array<[string, TestUser, 'ficha' | 'alta' | 'export', string]> = [
      ['titular', titular, 'ficha', 'admin'],
      ['directora', directora, 'ficha', 'directora'],
      ['profe', profe, 'ficha', 'profe'],
      ['tutor1', tutor1, 'alta', 'tutor_legal'],
      ['autorizado', autorizado, 'export', 'autorizado'],
    ]
    for (const [k, , origen] of casos) {
      const { data, error } = await s[k]!.rpc('get_info_medica_emergencia', {
        p_nino_id: nino.id,
        p_origen: origen,
      })
      expect(error).toBeNull()
      expect(data?.[0]?.alergias_graves).toBe('Frutos secos')
    }

    const filas = await lecturasDe(nino.id)
    expect(filas).toHaveLength(casos.length)
    casos.forEach(([, u, origen, rol], i) => {
      expect(filas[i]).toMatchObject({
        lector_id: u.id,
        rol_lector: rol,
        origen,
        centro_id: centro.id,
        campos: ['alergias_graves', 'medicacion_habitual'],
      })
    })
  })

  it('sin ficha también se registra, con los campos vacíos', async () => {
    const { error } = await s.titular!.rpc('get_info_medica_emergencia', {
      p_nino_id: ninoSinFicha.id,
    })
    expect(error).toBeNull()
    const filas = await lecturasDe(ninoSinFicha.id)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ origen: 'ficha', campos: [] })
  })

  it('una lectura no autorizada no descifra ni deja fila; un origen inventado, tampoco', async () => {
    const antes = (await lecturasDe(nino.id)).length
    // Premisa: hay lecturas con las que comparar.
    expect(antes).toBeGreaterThan(0)
    for (const k of ['sinPermiso', 'titularOtro']) {
      const { data, error } = await s[k]!.rpc('get_info_medica_emergencia', { p_nino_id: nino.id })
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    }
    const raro = await s.titular!.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
      p_origen: 'curiosidad',
    })
    expect(raro.error?.code).toBe('22023')
    expect(await lecturasDe(nino.id)).toHaveLength(antes)
  })

  it('con sesión nadie lee la ficha ni el registro directamente', async () => {
    for (const k of ['titular', 'directora', 'profe', 'tutor1', 'autorizado']) {
      const ficha = await s[k]!.from('info_medica_emergencia').select('nino_id').limit(1)
      expect(ficha.error?.code).toBe('42501')
      const registro = await s[k]!.from('lecturas_ficha_medica').select('id').limit(1)
      expect(registro.error?.code).toBe('42501')
    }
  })

  it('las listas reciben los avisos con las mismas condiciones que tenían las políticas', async () => {
    const ids = [nino.id, ninoSinFicha.id, ninoOtroCentro.id]
    const avisos = async (k: string) =>
      ((await s[k]!.rpc('alertas_medicas', { p_nino_ids: ids })).data ?? []).map((a) => a.nino_id)
    // Dirección y la profe del aula: el niño con ficha (el de otro centro, no; el sin ficha no
    // tiene fila).
    expect(await avisos('titular')).toEqual([nino.id])
    expect(await avisos('directora')).toEqual([nino.id])
    expect(await avisos('profe')).toEqual([nino.id])
    expect(await avisos('tutor1')).toEqual([nino.id])
    // Sin permiso o de otro centro, nada de este centro.
    expect(await avisos('sinPermiso')).toEqual([])
    expect(await avisos('titularOtro')).toEqual([ninoOtroCentro.id])
    const { data } = await s.profe!.rpc('alertas_medicas', { p_nino_ids: [nino.id] })
    expect(data?.[0]).toEqual({ nino_id: nino.id, alergia_grave: true, medicacion: true })
  })

  it('el registro lo ven los dos tutores legales y la Dirección; nadie más', async () => {
    for (const k of ['tutor1', 'tutor2', 'titular', 'directora']) {
      const { data, error } = await s[k]!.rpc('lecturas_ficha_medica', { p_nino_id: nino.id })
      expect(error).toBeNull()
      const quien = (data ?? []).map((l) => l.lector_nombre)
      expect(quien).toContain('Profe Lecturas')
      expect(quien).toContain('Tutora Lecturas Uno')
      expect(data?.find((l) => l.rol_lector === 'profe')?.campos).toEqual([
        'alergias_graves',
        'medicacion_habitual',
      ])
    }
    for (const k of ['profe', 'autorizado', 'titularOtro']) {
      const { error } = await s[k]!.rpc('lecturas_ficha_medica', { p_nino_id: nino.id })
      expect(error?.code).toBe('42501')
    }
  })

  it('el export del niño lleva el registro', async () => {
    const { data, error } = await s.tutor2!.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'nino',
      p_sujeto_id: nino.id,
    })
    expect(error).toBeNull()
    const lecturas = (data as { lecturas_ficha_medica: Record<string, unknown>[] })
      .lecturas_ficha_medica
    // Premisa: el registro tiene filas.
    expect(lecturas.length).toBeGreaterThan(0)
    expect(lecturas).toContainEqual(
      expect.objectContaining({
        lector: 'Directora Lecturas',
        rol_lector: 'directora',
        origen: 'ficha',
        campos: ['alergias_graves', 'medicacion_habitual'],
      })
    )
  })

  it('el plazo borra solo lo vencido, y en simulación no borra nada', async () => {
    const viejo = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString()
    const { error: iErr } = await serviceClient.from('lecturas_ficha_medica').insert({
      nino_id: nino.id,
      centro_id: centro.id,
      lector_id: profe.id,
      rol_lector: 'profe',
      origen: 'ficha',
      campos: ['alergias_graves'],
      leida_en: viejo,
    })
    expect(iErr).toBeNull()
    const antes = (await lecturasDe(nino.id)).length

    const sim = await serviceClient.rpc('purgar_lecturas_ficha_medica', {
      p_meses: 24,
      p_simular: true,
    })
    expect(sim.error).toBeNull()
    expect(sim.data).toBeGreaterThanOrEqual(1)
    expect(await lecturasDe(nino.id)).toHaveLength(antes)

    const real = await serviceClient.rpc('purgar_lecturas_ficha_medica', {
      p_meses: 24,
      p_simular: false,
    })
    expect(real.error).toBeNull()
    expect(real.data).toBeGreaterThanOrEqual(1)
    expect(await lecturasDe(nino.id)).toHaveLength(antes - 1)

    // Con sesión no se ejecuta.
    const conSesion = await s.titular!.rpc('purgar_lecturas_ficha_medica', {
      p_meses: 1,
      p_simular: false,
    })
    expect(conSesion.error?.code).toBe('42501')
  })

  it('con el niño de baja y el vínculo cerrado, el registro sigue y la Dirección lo ve', async () => {
    const { error: lErr } = await s.tutor2!.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
      p_origen: 'ficha',
    })
    expect(lErr).toBeNull()
    const antes = await lecturasDe(nino.id)
    // Premisa: el tutor que se va tiene su lectura en el registro.
    expect(antes.some((l) => l.lector_id === tutor2.id)).toBe(true)

    const baja = new Date().toISOString()
    const n = await serviceClient
      .from('ninos')
      .update({ deleted_at: baja, deleted_reason: 'baja_nino' })
      .eq('id', nino.id)
      .select('id')
    expect(n.error).toBeNull()
    expect(n.data).toHaveLength(1)
    const v = await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_at: baja, deleted_reason: 'baja_nino' })
      .eq('nino_id', nino.id)
      .select('id')
    expect(v.error).toBeNull()
    expect(v.data).toHaveLength(4)

    // No se borra nada, y la familia ya no lo ve en la app: se lo entrega la Dirección.
    expect(await lecturasDe(nino.id)).toEqual(antes)
    for (const k of ['tutor1', 'tutor2']) {
      const { error } = await s[k]!.rpc('lecturas_ficha_medica', { p_nino_id: nino.id })
      expect(error?.code).toBe('42501')
    }
    for (const k of ['titular', 'directora']) {
      const { data, error } = await s[k]!.rpc('lecturas_ficha_medica', { p_nino_id: nino.id })
      expect(error).toBeNull()
      expect(data).toHaveLength(antes.length)
      expect((data ?? []).map((l) => l.lector_nombre)).toContain('Tutor Lecturas Dos')
    }
  })

  it('la purga del niño borra sus lecturas, y las de otro niño se quedan', async () => {
    const otras = (await lecturasDe(ninoSinFicha.id)).length
    // Premisa: los dos niños tienen lecturas.
    expect((await lecturasDe(nino.id)).length).toBeGreaterThan(0)
    expect(otras).toBeGreaterThan(0)

    const { data: id, error } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: nino.id,
      p_inmediato: true,
    })
    expect(error).toBeNull()
    const purga = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: id as string })
    expect(purga.error).toBeNull()

    expect(await lecturasDe(nino.id)).toHaveLength(0)
    expect(await lecturasDe(ninoSinFicha.id)).toHaveLength(otras)
  })
})
