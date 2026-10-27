import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Peticiones de olvido desde la app (`20261126120000`, docs/specs/olvido-peticiones.md).
 *
 * La familia pide; nada se borra hasta que la titular confirma, y solo sin bloqueos. Rechazar
 * exige motivo y la familia lo lee; retirar lo puede cualquiera de los dos tutores legales;
 * confirmar abre 7 días en los que la titular puede deshacer, y la purga solo coge confirmadas.
 * Los recibos no bloquean el olvido del niño y sí el del tutor.
 */

type Sesion = SupabaseClient<Database>

describe('Peticiones de olvido', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let ninoA: TestNino // matriculado
  let ninoB: TestNino // dado de baja
  let tutor1: TestUser
  let tutor2: TestUser
  let autorizado: TestUser
  let extrano: TestUser
  let titular: TestUser
  let directora: TestUser
  let c1: Sesion
  let c2: Sesion
  let cAut: Sesion
  let cExt: Sesion
  let cTit: Sesion
  let cDir: Sesion
  const usuarios: TestUser[] = []

  async function fila(id: string) {
    const { data } = await serviceClient
      .from('olvido_solicitudes')
      .select('*')
      .eq('id', id)
      .single()
    return data!
  }

  async function nino(id: string) {
    const { data } = await serviceClient
      .from('ninos')
      .select('deleted_at, deleted_reason')
      .eq('id', id)
      .single()
    return data!
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Peticiones Olvido')
    curso = await createTestCurso(centro.id, 'activo')
    aula = await createTestAula(centro.id, curso.id, 'Aula Olvido')
    ninoA = await createTestNino(centro.id, 'Niño Demo Olvido A')
    ninoB = await createTestNino(centro.id, 'Niño Demo Olvido B')
    await matricular(ninoA.id, aula.id, curso.id)
    await matricular(ninoB.id, aula.id, curso.id)

    tutor1 = await createTestUser({ nombre: 'Tutora Demo Uno' })
    tutor2 = await createTestUser({ nombre: 'Tutor Demo Dos' })
    autorizado = await createTestUser({ nombre: 'Autorizado Demo' })
    extrano = await createTestUser({ nombre: 'Extraño Demo' })
    titular = await createTestUser({ nombre: 'Titular Demo' })
    directora = await createTestUser({ nombre: 'Directora Demo' })
    usuarios.push(tutor1, tutor2, autorizado, extrano, titular, directora)

    await asignarRol(titular.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    for (const n of [ninoA, ninoB]) {
      await crearVinculo(n.id, tutor1.id, 'tutor_legal_principal')
      await crearVinculo(n.id, tutor2.id, 'tutor_legal_secundario')
      await crearVinculo(n.id, autorizado.id, 'autorizado')
    }
    await asignarRol(tutor1.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(ninoB.familia_id, tutor1.id, 'titular')

    c1 = await clientFor(tutor1)
    c2 = await clientFor(tutor2)
    cAut = await clientFor(autorizado)
    cExt = await clientFor(extrano)
    cTit = await clientFor(titular)
    cDir = await clientFor(directora)
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  it('pide un tutor legal; un autorizado o alguien de fuera, no', async () => {
    const aut = await cAut.rpc('pedir_olvido_nino', { p_nino_id: ninoA.id })
    expect(aut.error?.code).toBe('42501')
    const ext = await cExt.rpc('pedir_olvido_nino', { p_nino_id: ninoA.id })
    expect(ext.error?.code).toBe('42501')

    const { data: id, error } = await c1.rpc('pedir_olvido_nino', { p_nino_id: ninoA.id })
    expect(error).toBeNull()
    const p = await fila(id!)
    expect(p.estado).toBe('pendiente')
    expect(p.pedida_por_centro).toBe(false)
    expect(p.gracia_hasta).toBeNull()
    // Pedir no borra nada.
    expect((await nino(ninoA.id)).deleted_at).toBeNull()

    const otra = await c2.rpc('pedir_olvido_nino', { p_nino_id: ninoA.id })
    expect(otra.error?.code).toBe('23505')
    expect(otra.error?.hint).toBe('ya_pedida')
  })

  it('el otro tutor y la titular ven lo que falta; la directora no ve nada', async () => {
    const { data: mias } = await c2.rpc('mis_peticiones_olvido')
    const mia = (mias ?? []).find((p) => p.sujeto_id === ninoA.id && p.estado === 'pendiente')
    expect(mia).toBeDefined()
    expect(mia!.pedida_por_mi).toBe(false)
    expect(mia!.puede_retirar).toBe(true)
    expect(mia!.falta).toMatchObject({ bloqueos: [{ codigo: 'matricula_viva', n: 1 }] })

    const { data: delCentro, error } = await cTit.rpc('peticiones_olvido_centro', {
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    const suya = (delCentro ?? []).find((p) => p.sujeto_id === ninoA.id && p.estado === 'pendiente')
    expect(suya?.falta).toMatchObject({ bloqueos: [{ codigo: 'matricula_viva' }] })
    expect(suya?.solicitado_por_nombre).toBe('Tutora Demo Uno')

    const dir = await cDir.rpc('peticiones_olvido_centro', { p_centro_id: centro.id })
    expect(dir.error?.code).toBe('42501')
  })

  it('con el niño matriculado no se confirma, ni la directora confirma', async () => {
    const { data: mias } = await c1.rpc('mis_peticiones_olvido')
    const id = mias!.find((p) => p.sujeto_id === ninoA.id && p.estado === 'pendiente')!.id

    const dir = await cDir.rpc('confirmar_peticion_olvido', { p_solicitud_id: id })
    expect(dir.error?.code).toBe('42501')
    const tit = await cTit.rpc('confirmar_peticion_olvido', { p_solicitud_id: id })
    expect(tit.error?.hint).toBe('hay_bloqueos')
    expect((await fila(id)).estado).toBe('pendiente')
    expect((await nino(ninoA.id)).deleted_at).toBeNull()
  })

  it('la retira el otro tutor legal (no quien la pidió); un autorizado, no', async () => {
    const { data: mias } = await c2.rpc('mis_peticiones_olvido')
    const id = mias!.find((p) => p.sujeto_id === ninoA.id && p.estado === 'pendiente')!.id

    const aut = await cAut.rpc('retirar_peticion_olvido', { p_solicitud_id: id })
    expect(aut.error?.code).toBe('42501')
    const { error } = await c2.rpc('retirar_peticion_olvido', { p_solicitud_id: id })
    expect(error).toBeNull()
    const p = await fila(id)
    expect(p.estado).toBe('retirada')
    expect(p.retirada_por).toBe(tutor2.id)

    const otra = await c1.rpc('retirar_peticion_olvido', { p_solicitud_id: id })
    expect(otra.error?.hint).toBe('no_pendiente')
  })

  it('rechazar exige motivo, y la familia lo lee', async () => {
    const { data: id } = await c1.rpc('pedir_olvido_nino', { p_nino_id: ninoA.id })
    expect(id).toBeTruthy()

    const sin = await cTit.rpc('rechazar_peticion_olvido', { p_solicitud_id: id!, p_motivo: '  ' })
    expect(sin.error?.hint).toBe('motivo_obligatorio')
    const { error } = await cTit.rpc('rechazar_peticion_olvido', {
      p_solicitud_id: id!,
      p_motivo: 'Sigue matriculado este curso',
    })
    expect(error).toBeNull()

    const { data: mias } = await c2.rpc('mis_peticiones_olvido')
    const p = mias!.find((m) => m.id === id)
    expect(p?.estado).toBe('rechazada')
    expect(p?.motivo_rechazo).toBe('Sigue matriculado este curso')
    expect(p?.puede_retirar).toBe(false)
  })

  it('niño de baja: los recibos de la familia avisan sin bloquear; confirmar, 7 días y deshacer', async () => {
    // La baja: matrícula en baja, niño y vínculos retirados por la baja (como archivar_nino).
    const hoy = new Date().toISOString().slice(0, 10)
    await serviceClient
      .from('matriculas')
      .update({ estado: 'baja', fecha_baja: hoy })
      .eq('nino_id', ninoB.id)
    const baja = new Date().toISOString()
    await serviceClient
      .from('ninos')
      .update({ deleted_at: baja, deleted_reason: 'baja_nino' })
      .eq('id', ninoB.id)
    await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_at: baja, deleted_reason: 'baja_nino' })
      .eq('nino_id', ninoB.id)
    const { error: rErr } = await serviceClient.from('recibos').insert({
      centro_id: centro.id,
      familia_id: ninoB.familia_id,
      anio: 2026,
      mes: 9,
      metodo: 'sepa',
      es_esporadico: false,
      estado: 'borrador',
      total_centimos: 25000,
    })
    expect(rErr).toBeNull()
    const antes = await nino(ninoB.id)

    // Con el vínculo retirado por la baja, la tutora sigue pudiendo pedir.
    const { data: id, error } = await c1.rpc('pedir_olvido_nino', { p_nino_id: ninoB.id })
    expect(error).toBeNull()
    const { data: delCentro } = await cTit.rpc('peticiones_olvido_centro', {
      p_centro_id: centro.id,
    })
    const p = delCentro!.find((x) => x.id === id)
    expect(p?.falta).toEqual({
      bloqueos: [],
      avisos: [{ codigo: 'recibos_familia_pendientes', n: 1 }],
    })

    const { data: gracia, error: cErr } = await cTit.rpc('confirmar_peticion_olvido', {
      p_solicitud_id: id!,
    })
    expect(cErr).toBeNull()
    const dias = (new Date(gracia!).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThan(7.1)
    expect((await nino(ninoB.id)).deleted_reason).toBe('solicitud_olvido')
    // La purga todavía no la coge: la gracia no ha vencido.
    const { data: vencidas } = await serviceClient.rpc('olvido_pendientes')
    expect((vencidas ?? []).some((v) => v.solicitud_id === id)).toBe(false)

    const { error: dErr } = await cTit.rpc('deshacer_confirmacion_olvido', { p_solicitud_id: id! })
    expect(dErr).toBeNull()
    expect(await nino(ninoB.id)).toEqual(antes)
    const vuelta = await fila(id!)
    expect(vuelta.estado).toBe('pendiente')
    expect(vuelta.gracia_hasta).toBeNull()
    expect(vuelta.estado_previo).toBeNull()
  })

  it('la cuenta del tutor: los recibos de su familia sí bloquean', async () => {
    const { data: id, error } = await c1.rpc('pedir_olvido_usuario', {
      p_usuario_id: tutor1.id,
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    const { data: mias } = await c1.rpc('mis_peticiones_olvido')
    const p = mias!.find((m) => m.id === id)
    // Tiene además al niño A matriculado (bloqueo propio); los recibos bloquean aparte.
    const bloqueos = (p?.falta as { bloqueos: { codigo: string }[] } | null)?.bloqueos ?? []
    expect(bloqueos.map((x) => x.codigo)).toEqual(['hijos_matriculados', 'recibos_pendientes'])

    const tit = await cTit.rpc('confirmar_peticion_olvido', { p_solicitud_id: id! })
    expect(tit.error?.hint).toBe('hay_bloqueos')
    // Nada se ha tocado: sigue con su rol.
    const { data: roles } = await serviceClient
      .from('roles_usuario')
      .select('deleted_at')
      .eq('usuario_id', tutor1.id)
      .eq('centro_id', centro.id)
    expect((roles ?? []).every((r) => r.deleted_at === null)).toBe(true)

    // Otra persona no pide por la cuenta de nadie; la titular sí, en su nombre.
    const ajena = await c2.rpc('pedir_olvido_usuario', {
      p_usuario_id: tutor1.id,
      p_centro_id: centro.id,
    })
    expect(ajena.error?.code).toBe('42501')
  })

  it('la purga solo coge confirmadas, y al purgar se vacían el motivo y la nota', async () => {
    // Premisa: el niño B tiene una pendiente (la del test anterior a deshacer) y el A una rechazada
    // con motivo.
    const { data: delCentro } = await cTit.rpc('peticiones_olvido_centro', {
      p_centro_id: centro.id,
    })
    const pendienteB = delCentro!.find((x) => x.sujeto_id === ninoB.id && x.estado === 'pendiente')!
    const rechazadaA = delCentro!.find((x) => x.sujeto_id === ninoA.id && x.estado === 'rechazada')!
    expect(rechazadaA.motivo_rechazo).not.toBeNull()

    const { error: nErr } = await cTit.rpc('nota_peticion_olvido', {
      p_solicitud_id: pendienteB.id,
      p_nota: 'Falta un recibo de septiembre',
    })
    expect(nErr).toBeNull()
    const { data: vencidas } = await serviceClient.rpc('olvido_pendientes')
    const ids = (vencidas ?? []).map((v) => v.solicitud_id)
    expect(ids).not.toContain(pendienteB.id)
    expect(ids).not.toContain(rechazadaA.id)

    // Una del niño A confirmada sin espera, ya vencida: sí la coge. Al marcarla purgada, el
    // motivo de su rechazada de antes se vacía.
    const { data: inm } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: ninoA.id,
      p_inmediato: true,
    })
    const { data: vencidas2 } = await serviceClient.rpc('olvido_pendientes')
    expect((vencidas2 ?? []).map((v) => v.solicitud_id)).toContain(inm)
    const { error: pErr } = await serviceClient
      .from('olvido_solicitudes')
      .update({ purgado_en: new Date().toISOString() })
      .eq('id', inm as string)
    expect(pErr).toBeNull()
    expect((await fila(rechazadaA.id)).motivo_rechazo).toBeNull()
    // La nota de otro niño no se toca.
    expect((await fila(pendienteB.id)).nota_centro).toBe('Falta un recibo de septiembre')
  })

  it('con sesión nadie escribe la tabla ni usa la función vieja', async () => {
    const ins = await cTit
      .from('olvido_solicitudes')
      .insert({ sujeto_tipo: 'nino', sujeto_id: ninoA.id, centro_id: centro.id })
    expect(ins.error?.code).toBe('42501')
    const vieja = await cTit.rpc('solicitar_olvido_nino', { p_nino_id: ninoA.id })
    expect(vieja.error?.code).toBe('42501')
  })
})
