import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

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

type Cliente = SupabaseClient<Database>
type Quien = 'titular' | 'segundo' | 'admin' | 'profe' | 'otraProfe' | 'autorizado'
type ArgsIdentidad = Database['public']['Functions']['actualizar_identidad_nino_tutor']['Args']

const PDF = Buffer.from('%PDF-1.4\n%demo\n')

/**
 * Fase 7 (`20270119120000`, 2026-11-13): la tarjeta sanitaria del niño. Medido ABIERTO en producción
 * antes (ensayo terminado en RAISE): no había dónde guardarla y un alta se cerraba sin ella. Aquí:
 *
 *  - D7: el número en claro en `ninos`, cerrado para la sesión; lo escribe el tutor por la función
 *    (con el alta validada, a la cola: 42501 `cola_validacion`) y la Dirección con su sesión.
 *    Cualquier tarjeta: la forma que comparten todas (5 a 30 letras o cifras).
 *  - Lo leen la Dirección, el tutor legal y la profe del niño (`sip_de_ninos`); la imagen, solo los
 *    dos primeros; el autorizado, nada.
 *  - D8: la imagen en su bucket `sip-ninos`, con la regla de `libro-familia`; la ruta, por
 *    `fijar_sip_documento_nino` (con el alta validada, el tutor a la cola).
 *
 * Que el cierre exige el número lo mide `alta-exige-datos-nino.rls.test.ts`; la purga,
 * `purga-rgpd-nino.test.ts`; el catálogo de buckets, `catalogo-buckets.rls.test.ts`.
 *
 * Fixtures ficticios. Una familia con dos hijos: Lucas (alta validada) y Mía (alta en curso).
 */
describe('La tarjeta sanitaria del niño (fase 7)', () => {
  let centro: TestCentro
  let lucas: string
  let mia: string
  const u = {} as Record<Quien, TestUser>
  const sesion = {} as Record<Quien, Cliente>
  const subidos: string[] = []

  const ruta = (nino: string, nombre: string) => `${centro.id}/${nino}/${nombre}.pdf`
  const identidad = (quien: Quien, nino: string, extra: Record<string, unknown>) =>
    sesion[quien].rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: nino,
      p_primer_apellido: null,
      p_segundo_apellido: null,
      p_fecha_nacimiento: null,
      p_sexo: null,
      p_nacionalidad: null,
      p_idioma_principal: null,
      ...extra,
    } as unknown as ArgsIdentidad)
  const guardada = async (nino: string) =>
    (await serviceClient.from('ninos').select('sip, sip_documento_path').eq('id', nino).single())
      .data
  const poner = async (
    nino: string,
    v: { sip?: string | null; sip_documento_path?: string | null }
  ) => {
    const { error } = await serviceClient.from('ninos').update(v).eq('id', nino)
    if (error) throw new Error(error.message)
  }
  const lee = (quien: Quien, nino: string) =>
    sesion[quien].rpc('sip_de_ninos', { p_nino_ids: [nino] })
  const fijar = (quien: Quien, nino: string, path: string) =>
    sesion[quien].rpc('fijar_sip_documento_nino', { p_nino_id: nino, p_path: path })

  beforeAll(async () => {
    centro = await createTestCentro('Centro Tarjeta Sanitaria')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    const aula = (await createTestAula(centro.id, curso)).id
    const otraAula = (await createTestAula(centro.id, curso)).id
    for (const q of ['titular', 'segundo', 'admin', 'profe', 'otraProfe', 'autorizado'] as Quien[])
      u[q] = await createTestUser({ nombre: `${q} Tarjeta Sanitaria` })
    const n = await createTestNino(centro.id, 'Lucas')
    lucas = n.id
    const { data: m, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: n.familia_id,
        nombre: 'Mía',
        primer_apellido: 'Apellido Test',
        fecha_nacimiento: '2025-01-10',
      })
      .select('id')
      .single()
    if (error || !m) throw new Error(`Mía: ${error?.message}`)
    mia = m.id
    await matricular(lucas, aula, curso)
    await matricular(mia, aula, curso)
    const { error: eM } = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', mia)
    if (eM) throw new Error(eM.message)
    for (const nino of [lucas, mia]) {
      await crearVinculo(nino, u.titular.id, 'tutor_legal_principal')
      await crearVinculo(nino, u.segundo.id, 'tutor_legal_secundario')
      await crearVinculo(nino, u.autorizado.id, 'autorizado')
    }
    await asignarRol(u.admin.id, centro.id, 'admin')
    await asignarRol(u.profe.id, centro.id, 'profe')
    await asignarRol(u.otraProfe.id, centro.id, 'profe')
    await asignarProfeAula(u.profe.id, aula, curso)
    await asignarProfeAula(u.otraProfe.id, otraAula, curso)
    for (const q of Object.keys(u) as Quien[]) sesion[q] = await clientFor(u[q])
  }, 120_000)

  afterAll(async () => {
    if (subidos.length) await serviceClient.storage.from('sip-ninos').remove(subidos)
    if (centro) await deleteTestCentro(centro.id)
    for (const x of Object.values(u)) if (x) await deleteTestUser(x.id)
  })

  it('premisa: Lucas validado y Mía en curso, los dos sin tarjeta', async () => {
    const { data } = await serviceClient
      .from('matriculas')
      .select('nino_id, estado')
      .in('nino_id', [lucas, mia])
    expect(Object.fromEntries((data ?? []).map((r) => [r.nino_id, r.estado]))).toEqual({
      [lucas]: 'activa',
      [mia]: 'pendiente',
    })
    expect(await guardada(lucas)).toEqual({ sip: null, sip_documento_path: null })
    expect(await guardada(mia)).toEqual({ sip: null, sip_documento_path: null })
  })

  describe('el número', () => {
    it('la sesión no lo lee de la tabla (nace cerrado, como el DNI)', async () => {
      const { error } = await sesion.titular.from('ninos').select('sip').eq('id', lucas)
      expect(error?.code).toBe('42501')
      // Control: la misma sesión sí lee una columna abierta de la misma fila.
      const abierta = await sesion.titular.from('ninos').select('nombre').eq('id', lucas)
      expect(abierta.error).toBeNull()
      expect(abierta.data).toHaveLength(1)
    })

    it('en alta: se guarda sin espacios, puntos, guiones ni barras, en mayúsculas', async () => {
      const { error } = await identidad('titular', mia, { p_sip: ' 1234.56/78-ab ' })
      expect(error).toBeNull()
      expect((await guardada(mia))?.sip).toBe('12345678AB')
    })

    it('cualquier tarjeta: la forma de otra comunidad (CIP-SNS) pasa; 3 caracteres, no', async () => {
      expect((await identidad('titular', mia, { p_sip: 'BBBBBBBBQR648597' })).error).toBeNull()
      expect((await guardada(mia))?.sip).toBe('BBBBBBBBQR648597')
      const corta = await identidad('titular', mia, { p_sip: 'M-12' })
      expect(corta.error?.code).toBe('23514')
      expect((await guardada(mia))?.sip).toBe('BBBBBBBBQR648597')
    })

    it('la llamada de antes, sin p_sip, sigue llegando a la función y no toca la tarjeta', async () => {
      const { error } = await identidad('titular', mia, { p_lugar_nacimiento: 'Lugar Demo' })
      expect(error).toBeNull()
      expect((await guardada(mia))?.sip).toBe('BBBBBBBBQR648597')
    })

    it('con el alta validada, un cambio va a la cola; el mismo número escrito de otra forma, no', async () => {
      await poner(lucas, { sip: 'ABC12345' })
      const cambio = await identidad('titular', lucas, { p_sip: 'X9999999' })
      expect(cambio.error?.code).toBe('42501')
      expect(cambio.error?.hint).toBe('cola_validacion')
      expect((await guardada(lucas))?.sip).toBe('ABC12345')
      const igual = await identidad('titular', lucas, { p_sip: ' abc-123.45 ' })
      expect(igual.error).toBeNull()
      expect((await guardada(lucas))?.sip).toBe('ABC12345')
    })

    it('la Dirección escribe con su sesión; la tutora y el autorizado, 0 filas', async () => {
      const dir = await sesion.admin
        .from('ninos')
        .update({ sip: 'DIRECCION1' })
        .eq('id', lucas)
        .select('id')
      expect(dir.error).toBeNull()
      expect(dir.data).toHaveLength(1)
      for (const quien of ['titular', 'autorizado'] as const) {
        const r = await sesion[quien]
          .from('ninos')
          .update({ sip: 'COLADO123' })
          .eq('id', lucas)
          .select('id')
        expect.soft(r.data ?? [], quien).toHaveLength(0)
      }
      expect((await guardada(lucas))?.sip).toBe('DIRECCION1')
    })
  })

  describe('quién lo lee (sip_de_ninos)', () => {
    beforeAll(async () => {
      await poner(lucas, { sip: 'LEER12345', sip_documento_path: ruta(lucas, 'sip-leer') })
    })

    it('la Dirección y los dos tutores: el número y la imagen', async () => {
      for (const quien of ['admin', 'titular', 'segundo'] as const) {
        const { data, error } = await lee(quien, lucas)
        expect.soft(error, quien).toBeNull()
        expect.soft(data, quien).toEqual([
          {
            nino_id: lucas,
            sip: 'LEER12345',
            sip_documento_path: ruta(lucas, 'sip-leer'),
            ve_documento: true,
          },
        ])
      }
    })

    it('la profe del aula: el número sí, la imagen no (y lo sabe: ve_documento false)', async () => {
      const { data, error } = await lee('profe', lucas)
      expect(error).toBeNull()
      expect(data).toEqual([
        { nino_id: lucas, sip: 'LEER12345', sip_documento_path: null, ve_documento: false },
      ])
    })

    it('el autorizado y la profe de otra aula: ninguna fila', async () => {
      for (const quien of ['autorizado', 'otraProfe'] as const) {
        const { data, error } = await lee(quien, lucas)
        expect.soft(error, quien).toBeNull()
        expect.soft(data ?? [], quien).toHaveLength(0)
      }
    })
  })

  describe('la imagen (fijar_sip_documento_nino)', () => {
    it('en alta, la tutora la fija y le devuelve la anterior', async () => {
      await poner(mia, { sip_documento_path: null })
      const { data, error } = await fijar('titular', mia, ruta(mia, 'sip-a'))
      expect(error).toBeNull()
      expect(data).toBeNull()
      expect((await guardada(mia))?.sip_documento_path).toBe(ruta(mia, 'sip-a'))
    })

    it('con el alta validada, la tutora va a la cola; la misma ruta no es un cambio', async () => {
      await poner(lucas, { sip_documento_path: ruta(lucas, 'sip-vieja') })
      const nueva = await fijar('titular', lucas, ruta(lucas, 'sip-nueva'))
      expect(nueva.error?.code).toBe('42501')
      expect(nueva.error?.hint).toBe('cola_validacion')
      const misma = await fijar('titular', lucas, ruta(lucas, 'sip-vieja'))
      expect(misma.error).toBeNull()
      expect((await guardada(lucas))?.sip_documento_path).toBe(ruta(lucas, 'sip-vieja'))
    })

    it('la Dirección la fija con el alta validada', async () => {
      const { data, error } = await fijar('admin', lucas, ruta(lucas, 'sip-dir'))
      expect(error).toBeNull()
      expect(data).toBe(ruta(lucas, 'sip-vieja'))
      expect((await guardada(lucas))?.sip_documento_path).toBe(ruta(lucas, 'sip-dir'))
    })

    it('una ruta de otro niño: 23514; el autorizado: 42501', async () => {
      expect((await fijar('titular', mia, ruta(lucas, 'sip-x'))).error?.code).toBe('23514')
      expect((await fijar('autorizado', mia, ruta(mia, 'sip-x'))).error?.code).toBe('42501')
      expect((await guardada(mia))?.sip_documento_path).toBe(ruta(mia, 'sip-a'))
    })
  })

  describe('el bucket sip-ninos', () => {
    const objeto = () => ruta(lucas, 'sip-objeto')

    it('la tutora sube a la carpeta de su hijo (y lo relee)', async () => {
      const { error } = await sesion.titular.storage
        .from('sip-ninos')
        .upload(objeto(), PDF, { contentType: 'application/pdf' })
      expect(error).toBeNull()
      subidos.push(objeto())
      const lectura = await sesion.titular.storage.from('sip-ninos').download(objeto())
      expect(lectura.error).toBeNull()
    })

    it('la profe del aula no la abre (la imagen no es suya); el autorizado no sube', async () => {
      // Premisa: el objeto existe.
      const { data: hay } = await serviceClient.storage
        .from('sip-ninos')
        .list(`${centro.id}/${lucas}`)
      expect((hay ?? []).map((o) => o.name)).toContain('sip-objeto.pdf')
      const profe = await sesion.profe.storage.from('sip-ninos').download(objeto())
      expect(profe.error).not.toBeNull()
      const sube = await sesion.autorizado.storage
        .from('sip-ninos')
        .upload(ruta(lucas, 'sip-autorizado'), PDF, { contentType: 'application/pdf' })
      expect(sube.error).not.toBeNull()
    })

    it('borrar, solo la Dirección', async () => {
      await sesion.titular.storage.from('sip-ninos').remove([objeto()])
      const tras = await serviceClient.storage.from('sip-ninos').list(`${centro.id}/${lucas}`)
      expect((tras.data ?? []).map((o) => o.name)).toContain('sip-objeto.pdf')
      const { error } = await sesion.admin.storage.from('sip-ninos').remove([objeto()])
      expect(error).toBeNull()
      const fin = await serviceClient.storage.from('sip-ninos').list(`${centro.id}/${lucas}`)
      expect((fin.data ?? []).map((o) => o.name)).not.toContain('sip-objeto.pdf')
    })
  })

  describe('la cola de la imagen', () => {
    const encolar = (path: string) =>
      sesion.titular
        .from('cambios_pendientes')
        .insert({
          centro_id: centro.id,
          nino_id: lucas,
          registro_id: lucas,
          entidad: 'ninos_sip_documento',
          payload: { path },
          solicitado_por: u.titular.id,
        })
        .select('id')
    it('con la ruta de su hijo entra; con la de otro, el CHECK la para', async () => {
      const otra = await encolar(ruta(mia, 'sip-ajena'))
      expect(otra.error?.code).toBe('23514')
      const suya = await encolar(ruta(lucas, 'sip-cola'))
      expect(suya.error).toBeNull()
      expect(suya.data).toHaveLength(1)
    })
  })
})
