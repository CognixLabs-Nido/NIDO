import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
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
} from './setup'

/**
 * Fase 8a (`20270120120000` y `20270120130000`) — la fecha de incorporación.
 *
 * Jose (2026-11-14): «yo puedo validar un alta en enero para el curso siguiente que empieza en
 * septiembre». La pone Dirección al validar (`validar_alta`), es obligatoria, y `generar_recibos_mes`
 * no cobra NADA de un mes anterior al suyo. Medido abierto en producción antes: un niño validado para
 * septiembre recibía la escolaridad de febrero y de agosto.
 *
 * Los niños de `createTestNino` vienen incorporados «desde siempre» (`FECHA_INCORPORACION_DE_TEST`);
 * aquí se les quita o se les pone a propósito, y cada caso lo afirma antes de medir (regla 13).
 */

const ESCOLARIDAD = 30_000

describe('La fecha de incorporación (fase 8a)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let tutora: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let concepto: string
  /** Incorporado desde siempre: el control de que el motor cobra el mes que se mira. */
  let control: { id: string; familia_id: string }

  async function fecha(ninoId: string): Promise<string | null> {
    const { data, error } = await serviceClient
      .from('ninos')
      .select('fecha_incorporacion')
      .eq('id', ninoId)
      .single()
    if (error) throw new Error(`leer la fecha: ${error.message}`)
    return data.fecha_incorporacion
  }

  async function ponerFecha(ninoId: string, f: string) {
    const { error } = await serviceClient
      .from('ninos')
      .update({ fecha_incorporacion: f })
      .eq('id', ninoId)
    if (error) throw new Error(`poner la fecha: ${error.message}`)
    expect(await fecha(ninoId)).toBe(f) // premisa
  }

  /** Un niño con su alta terminada por la familia ('lista') y sin fecha: el de antes de validar. */
  async function altaLista(nombre: string) {
    const n = await createTestNino(centro.id, nombre)
    const q = await serviceClient.from('ninos').update({ fecha_incorporacion: null }).eq('id', n.id)
    if (q.error) throw new Error(`quitar la fecha: ${q.error.message}`)
    const { data, error } = await serviceClient
      .from('matriculas')
      .insert({ nino_id: n.id, aula_id: aula.id, curso_academico_id: curso.id, estado: 'lista' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`matrícula lista: ${error?.message}`)
    expect(await fecha(n.id)).toBeNull() // premisa: sin fecha
    return { ...n, matricula: data.id }
  }

  async function estado(matricula: string) {
    const { data } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('id', matricula)
      .single()
    return data?.estado
  }

  /** Lo que hace «Recalcular el mes»: sembrar los automáticos y generar. */
  async function recalcular(anio: number, mes: number) {
    const p = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
    expect(p.error).toBeNull()
    const g = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: anio,
      p_mes: mes,
    })
    expect(g.error).toBeNull()
  }

  async function cobrado(ninoId: string, anio: number, mes: number): Promise<number[]> {
    // En dos pasos: `lineas_recibo` tiene más de una clave a `recibos` y el embebido es ambiguo.
    const r = await serviceClient
      .from('recibos')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', anio)
      .eq('mes', mes)
    if (r.error) throw new Error(`recibos del mes: ${r.error.message}`)
    const ids = (r.data ?? []).map((x) => x.id)
    if (ids.length === 0) return []
    const { data, error } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos')
      .eq('nino_id', ninoId)
      .eq('concepto_id', concepto)
      .in('recibo_id', ids)
    if (error) throw new Error(`líneas: ${error.message}`)
    return (data ?? []).map((l) => l.importe_centimos)
  }

  async function recibosDe(familiaId: string, anio: number, mes: number) {
    const { data, error } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('familia_id', familiaId)
      .eq('anio', anio)
      .eq('mes', mes)
      .eq('es_esporadico', false)
    if (error) throw new Error(`recibos: ${error.message}`)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Fecha Incorporacion 8a')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Incorporacion 8a' })
    await asignarRol(admin.id, centro.id, 'admin')
    tutora = await createTestUser({ nombre: 'Tutora Incorporacion 8a' })
    cAdmin = await clientFor(admin)
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Escolaridad 8a',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        aplicacion: 'automatico',
        importe_centimos: ESCOLARIDAD,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    concepto = data.id
    // Un cargo de familia: sin él, una familia sin ningún hijo incorporado se quedaría sin líneas y
    // el motor borraría su recibo vacío igual, y «no tiene recibo» no distinguiría el filtro de las
    // familias del de los niños.
    const fam = await serviceClient.from('conceptos_cobro').insert({
      centro_id: centro.id,
      nombre: 'Material familia 8a',
      tipo_concepto: 'mensual',
      tipo_valor: 'fijo',
      signo: 1,
      ambito: 'familia',
      aplicacion: 'automatico',
      importe_centimos: 5_000,
    })
    if (fam.error) throw new Error(`concepto de familia: ${fam.error.message}`)
    control = await createTestNino(centro.id, 'Control Incorporado 8a')
    await matricular(control.id, aula.id, curso.id)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutora.id)
  }, 60_000)

  describe('validar el alta', () => {
    it('sin fecha no se valida, y el alta sigue lista', async () => {
      const n = await altaLista('Sin Fecha 8a')
      const { error } = await cAdmin.rpc('validar_alta', {
        p_matricula_id: n.matricula,
        p_fecha_incorporacion: null as unknown as string,
      })
      // 22004 es de `validar_alta`; la regla de la base daría 23514 con el mismo HINT.
      expect(error?.code).toBe('22004')
      expect(error?.hint).toBe('falta_fecha_incorporacion')
      expect(await estado(n.matricula)).toBe('lista')
      expect(await fecha(n.id)).toBeNull()
    })

    it('la tutora no valida (solo Dirección)', async () => {
      const n = await altaLista('Tutora Valida 8a')
      await crearFamiliaTutor(n.familia_id, tutora.id)
      await crearVinculo(n.id, tutora.id, 'tutor_legal_principal')
      const { data: esTutora } = await (
        await clientFor(tutora)
      ).rpc('es_tutor_legal_de', { p_nino_id: n.id })
      expect(esTutora).toBe(true) // premisa: es la tutora legal de ese niño
      const { error } = await (
        await clientFor(tutora)
      ).rpc('validar_alta', { p_matricula_id: n.matricula, p_fecha_incorporacion: '2027-09-01' })
      expect(error?.code).toBe('42501')
      expect(await estado(n.matricula)).toBe('lista')
    })

    it('Dirección valida con la fecha: activa y la fecha guardada, las dos cosas', async () => {
      const n = await altaLista('Valida 8a')
      const { data, error } = await cAdmin.rpc('validar_alta', {
        p_matricula_id: n.matricula,
        p_fecha_incorporacion: '2027-09-01',
      })
      expect(error).toBeNull()
      expect(data).toBe(n.matricula)
      expect(await estado(n.matricula)).toBe('activa')
      expect(await fecha(n.id)).toBe('2027-09-01')
      // Una segunda vez ya no está 'lista': NULL, y no cambia la fecha.
      const otra = await cAdmin.rpc('validar_alta', {
        p_matricula_id: n.matricula,
        p_fecha_incorporacion: '2028-01-01',
      })
      expect(otra.error).toBeNull()
      expect(otra.data).toBeNull()
      expect(await fecha(n.id)).toBe('2027-09-01')
    })
  })

  describe('el motor no cobra nada antes de la incorporación', () => {
    it('validado para septiembre: ni febrero ni agosto; septiembre, sí', async () => {
      const n = await altaLista('Septiembre 8a')
      const v = await cAdmin.rpc('validar_alta', {
        p_matricula_id: n.matricula,
        p_fecha_incorporacion: '2027-09-01',
      })
      expect(v.error).toBeNull()

      await recalcular(2027, 2)
      // Control: el motor cobra febrero a quien está incorporado (si no, el «0» de abajo no dice nada).
      expect(await cobrado(control.id, 2027, 2)).toEqual([ESCOLARIDAD])
      expect(await cobrado(n.id, 2027, 2)).toEqual([])
      // Su familia no tiene otro hijo: no hay recibo de febrero (ni el cargo de familia). Control:
      // la del niño incorporado sí lo tiene.
      expect(await recibosDe(control.familia_id, 2027, 2)).toHaveLength(1)
      expect(await recibosDe(n.familia_id, 2027, 2)).toEqual([])

      await recalcular(2027, 8)
      expect(await cobrado(control.id, 2027, 8)).toEqual([ESCOLARIDAD])
      expect(await cobrado(n.id, 2027, 8)).toEqual([])

      await recalcular(2027, 9)
      expect(await cobrado(n.id, 2027, 9)).toEqual([ESCOLARIDAD])
    })

    it('los bordes: el último día del mes lo cobra entero; el día 1 del siguiente, no', async () => {
      const n = await createTestNino(centro.id, 'Bordes 8a')
      await matricular(n.id, aula.id, curso.id)

      await ponerFecha(n.id, '2027-10-31')
      await recalcular(2027, 10)
      expect(await cobrado(n.id, 2027, 10)).toEqual([ESCOLARIDAD])

      await ponerFecha(n.id, '2027-11-01')
      await recalcular(2027, 10)
      expect(await cobrado(control.id, 2027, 10)).toEqual([ESCOLARIDAD]) // control
      expect(await cobrado(n.id, 2027, 10)).toEqual([])
    })

    it('dos hermanos: el que aún no ha venido no está en el recibo de la familia', async () => {
      const mayor = await createTestNino(centro.id, 'Hermano Mayor 8a')
      await matricular(mayor.id, aula.id, curso.id)
      const { data: pequeno, error } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: mayor.familia_id,
          nombre: 'Hermano Pequeno 8a',
          primer_apellido: 'Test',
          fecha_nacimiento: '2025-03-15',
          fecha_incorporacion: '2027-09-01',
        })
        .select('id')
        .single()
      if (error || !pequeno) throw new Error(`hermano: ${error?.message}`)
      await matricular(pequeno.id, aula.id, curso.id)
      expect(await fecha(pequeno.id)).toBe('2027-09-01') // premisa: matricular no la pisa

      await recalcular(2027, 3)
      expect(await cobrado(mayor.id, 2027, 3)).toEqual([ESCOLARIDAD])
      expect(await cobrado(pequeno.id, 2027, 3)).toEqual([])
      expect(await recibosDe(mayor.familia_id, 2027, 3)).toHaveLength(1)
    })
  })

  describe('la base lo exige', () => {
    it('activar una matrícula de un niño sin fecha, por cualquier camino: 23514', async () => {
      const n = await altaLista('Activa Sin Fecha 8a')
      const { error } = await serviceClient
        .from('matriculas')
        .update({ estado: 'activa' })
        .eq('id', n.matricula)
      expect(error?.code).toBe('23514')
      expect(error?.hint).toBe('falta_fecha_incorporacion')
      expect(await estado(n.matricula)).toBe('lista')
    })

    it('a un niño con matrícula activa no se le quita la fecha; a uno sin activa, sí', async () => {
      expect(await fecha(control.id)).not.toBeNull() // premisa: activa y con fecha
      const quitar = await serviceClient
        .from('ninos')
        .update({ fecha_incorporacion: null })
        .eq('id', control.id)
      expect(quitar.error?.code).toBe('23514')
      expect(await fecha(control.id)).not.toBeNull()

      const n = await altaLista('Lista Quita Fecha 8a')
      await ponerFecha(n.id, '2027-09-01')
      const libre = await serviceClient
        .from('ninos')
        .update({ fecha_incorporacion: null })
        .eq('id', n.id)
      expect(libre.error).toBeNull()
      expect(await fecha(n.id)).toBeNull()
    })

    it('reincorporar sin fecha no existe; con NULL, 22004', async () => {
      const dos = await cAdmin.rpc(
        'desarchivar_nino' as never,
        { p_nino_id: control.id, p_aula_id: aula.id } as never
      )
      expect(dos.error).not.toBeNull()
      const tres = await cAdmin.rpc('desarchivar_nino', {
        p_nino_id: control.id,
        p_aula_id: aula.id,
        p_fecha_incorporacion: null as unknown as string,
      })
      expect(tres.error?.hint).toBe('falta_fecha_incorporacion')
    })
  })
})
