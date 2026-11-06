import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// La operación es un .mjs que Jose ejecuta a mano; aquí se prueba el MISMO `operar`, con el SQL
// por psql (en solo lectura, como la Management API con `read_only`) y el Storage de la BD efímera.
import { operar } from '../../../supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs'

import {
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Operación 20270106120000: los ficheros de Storage sin dueño se borran por la API, con la lista
 * fija por md5 y sus guardas. Cada guarda tiene aquí su control negativo (aborta y no borra nada),
 * y el borrado de verdad se comprueba por lo que queda, no por el 200 de la API.
 */

// El mismo PDF de 15 bytes que subía f11g-validacion-purga (el origen de los 60 de producción).
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n')
const BUCKETS = ['dni-tutores', 'libro-familia', 'mandato-sepa'] as const

type Fila = Record<string, unknown>
type Storage = typeof serviceClient.storage

function sql(consulta: string): Promise<Fila[]> {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: `SELECT coalesce(json_agg(t), '[]'::json) FROM (${consulta}) t;`,
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  })
  return Promise.resolve(JSON.parse(salida.trim()) as Fila[])
}

const SIN_DUENO = `
  SELECT o.bucket_id, o.name FROM storage.objects o
   WHERE NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id::text = split_part(o.name, '/', 1))
     AND NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id::text = split_part(o.name, '/', 1))`

const huella = (bucket: string, nombre: string) =>
  createHash('md5').update(`${bucket}/${nombre}`).digest('hex')

async function existe(bucket: string, nombre: string): Promise<boolean | null> {
  const { data } = await serviceClient.storage.from(bucket).exists(nombre)
  return data
}

async function subir(bucket: string, nombre: string, cuerpo: Buffer = PDF) {
  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(nombre, cuerpo, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`subir ${bucket}/${nombre}: ${error.message}`)
}

describe('operación 20270106120000 — borrar por la API los ficheros sin dueño', () => {
  const centro = randomUUID() // no existe: los tres ficheros nacen sin dueño
  const nino = randomUUID()
  const huerfanos = BUCKETS.map((b) => ({ bucket: b, nombre: `${centro}/${nino}/${b}.pdf` }))
  const huellas = huerfanos.map((f) => huella(f.bucket, f.nombre))
  const esperado = {
    total: 3,
    porBucket: { 'dni-tutores': 1, 'libro-familia': 1, 'mandato-sepa': 1 },
    tamano: 15,
    mime: 'application/pdf',
  }
  let control: TestCentro
  let ninoControl: TestNino
  let usuario: TestUser
  let ficheroControl: string
  let previos: Fila[] = []
  const log: string[] = []
  const base = () => ({ sql, huellas, esperado, log: (l: string) => log.push(l) })

  beforeAll(async () => {
    // Lo que hayan dejado otros ficheros del shard: se cuenta (se imprime) y se recoge, para que
    // la guarda «ni uno sin dueño fuera de la lista» empiece desde cero. Solo en la BD efímera.
    previos = await sql(SIN_DUENO)
    console.warn(
      `[operacion-huerfanos] sin dueño antes de empezar: ${previos.length}` +
        previos.map((f) => `\n  ${f.bucket_id}/${f.name}`).join('')
    )
    for (const f of previos) {
      const { error } = await serviceClient.storage
        .from(String(f.bucket_id))
        .remove([String(f.name)])
      if (error) throw new Error(`recoger ${f.bucket_id}/${f.name}: ${error.message}`)
    }

    control = await createTestCentro('Centro control huérfanos')
    ninoControl = await createTestNino(control.id)
    usuario = await createTestUser({ nombre: 'Usuario huérfanos' })
    ficheroControl = `${control.id}/${ninoControl.id}/libro-familia.pdf`
    await subir('libro-familia', ficheroControl)
    for (const f of huerfanos) await subir(f.bucket, f.nombre)
  })

  afterAll(async () => {
    for (const f of huerfanos) await serviceClient.storage.from(f.bucket).remove([f.nombre])
    await serviceClient.storage.from('libro-familia').remove([ficheroControl])
    await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', usuario.id)
    await deleteTestCentro(control.id)
    await deleteTestUser(usuario.id)
  })

  it('premisa: los tres existen, son los únicos sin dueño, y el centro de control y su fichero existen', async () => {
    expect(await sql(SIN_DUENO)).toEqual(
      expect.arrayContaining(huerfanos.map((f) => ({ bucket_id: f.bucket, name: f.nombre })))
    )
    expect((await sql(SIN_DUENO)).length).toBe(3)
    for (const f of huerfanos) expect(await existe(f.bucket, f.nombre)).toBe(true)
    expect(await existe('libro-familia', ficheroControl)).toBe(true)
    expect(await sql(`SELECT 1 FROM public.centros WHERE id = '${control.id}'`)).toHaveLength(1)
  })

  it('el ensayo pasa todas las guardas, lo enseña por centro y no borra nada', async () => {
    log.length = 0
    await expect(
      operar({
        ...base(),
        storage: serviceClient.storage,
        centroControl: control.id,
        modo: 'ensayo',
      })
    ).rejects.toThrow(
      /^ENSAYO OK, nada borrado \| 3 ficheros de la lista, 0 sin dueño fuera de ella \| 0 referencias/
    )
    expect(log).toContain(`POR CENTRO | ${centro} | 1 | 1 | 1`)
    for (const f of huerfanos) expect(await existe(f.bucket, f.nombre)).toBe(true)
  })

  describe('cada guarda aborta sin borrar nada', () => {
    // Corren en modo aplicar: sin la guarda, la operación borra de verdad. Cada caso vuelve a subir
    // los tres, para que una guarda que falta ponga rojo su caso y no los siguientes.
    beforeEach(async () => {
      for (const f of huerfanos) await subir(f.bucket, f.nombre)
    })

    const intacto = async () => {
      for (const f of huerfanos) expect(await existe(f.bucket, f.nombre)).toBe(true)
    }

    it('aparece otro sin dueño que no está en la lista: falla y lo nombra, no lo barre', async () => {
      const intruso = `${randomUUID()}/${randomUUID()}/dni-tutores.pdf`
      await subir('dni-tutores', intruso)
      try {
        await expect(
          operar({
            ...base(),
            storage: serviceClient.storage,
            centroControl: control.id,
            modo: 'aplicar',
          })
        ).rejects.toThrow(`sin dueño y NO está en la lista: dni-tutores/${intruso}`)
        expect(await existe('dni-tutores', intruso)).toBe(true)
        await intacto()
      } finally {
        await serviceClient.storage.from('dni-tutores').remove([intruso])
      }
    })

    it('recuento: si se esperaban 4, no se borra', async () => {
      await expect(
        operar({
          ...base(),
          esperado: { ...esperado, total: 4 },
          storage: serviceClient.storage,
          centroControl: control.id,
          modo: 'aplicar',
        })
      ).rejects.toThrow('recuento: esperaba 4 ficheros y hay 3')
      await intacto()
    })

    it('tamaño: si no son de 15 bytes, no se borra', async () => {
      await expect(
        operar({
          ...base(),
          esperado: { ...esperado, tamano: 16 },
          storage: serviceClient.storage,
          centroControl: control.id,
          modo: 'aplicar',
        })
      ).rejects.toThrow('tiene 15 bytes, esperaba 16')
      await intacto()
    })

    it('una fila que nombra al niño: falla y dice qué columna', async () => {
      // preferencias_usuario no se audita: la referencia no se queda en audit_log al quitarla.
      const { error } = await serviceClient
        .from('preferencias_usuario')
        .insert({ usuario_id: usuario.id, clave: 'huerfanos_test', valor: `carpeta ${nino}` })
      expect(error).toBeNull()
      try {
        await expect(
          operar({
            ...base(),
            storage: serviceClient.storage,
            centroControl: control.id,
            modo: 'aplicar',
          })
        ).rejects.toThrow('referencia: 1 filas de public.preferencias_usuario.valor nombran alguno')
        await intacto()
      } finally {
        await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', usuario.id)
      }
    })

    it('control positivo del escaneo: un centro de control que no aparece en ninguna parte aborta', async () => {
      await expect(
        operar({
          ...base(),
          storage: serviceClient.storage,
          centroControl: randomUUID(),
          modo: 'aplicar',
        })
      ).rejects.toThrow('control positivo: el escaneo no encuentra ni el centro de control')
      await intacto()
    })

    it('si la API no los ve antes de borrar, el «ya no están» del final no probaría nada: aborta', async () => {
      const ciega = {
        from: (b: string) => ({
          ...serviceClient.storage.from(b),
          exists: async () => ({ data: false, error: null }),
        }),
      } as unknown as Storage
      await expect(
        operar({ ...base(), storage: ciega, centroControl: control.id, modo: 'aplicar' })
      ).rejects.toThrow('la API no lo ve antes de borrar')
      await intacto()
    })

    it('no basta el 200: una API que dice «borrado» y no borra da la guarda de después', async () => {
      const mentirosa = {
        from: (b: string) => {
          const real = serviceClient.storage.from(b)
          return {
            exists: (n: string) => real.exists(n),
            remove: async (nombres: string[]) => ({
              data: nombres.map((name) => ({ name })),
              error: null,
            }),
          }
        },
      } as unknown as Storage
      await expect(
        operar({ ...base(), storage: mentirosa, centroControl: control.id, modo: 'aplicar' })
      ).rejects.toThrow(/^GUARDA DESPUÉS DE BORRAR: revisar a mano \| sigue en storage\.objects/)
      await intacto()
    })
  })

  it('aplicar: los tres ya no están (ni en storage.objects ni en la API) y el fichero con dueño sigue', async () => {
    for (const f of huerfanos) await subir(f.bucket, f.nombre)
    for (const f of huerfanos) expect(await existe(f.bucket, f.nombre)).toBe(true) // premisa
    const resumen = await operar({
      ...base(),
      storage: serviceClient.storage,
      centroControl: control.id,
      modo: 'aplicar',
    })
    expect(resumen.borrados).toBe(3)
    for (const f of huerfanos) expect(await existe(f.bucket, f.nombre)).toBe(false)
    expect(
      await sql(
        `SELECT 1 FROM storage.objects WHERE md5(bucket_id || '/' || name) = ANY('{${huellas.join(',')}}'::text[])`
      )
    ).toHaveLength(0)
    expect(await sql(SIN_DUENO)).toHaveLength(0)
    expect(await existe('libro-familia', ficheroControl)).toBe(true)
  })
})
