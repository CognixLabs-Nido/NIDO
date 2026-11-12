import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Constants } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * Las normas de régimen interno, fuera del catálogo de autorizaciones (fase 4, 4b-3;
 * `20270110120000`). Decisión de Jose del 2026-11-06: «dos caminos para firmar lo mismo significa que
 * dentro de un año nadie sabrá cuál vale». Las normas son un documento del centro y se firman en el
 * alta; el tipo `reglas_regimen_interno` ya no existe, para nadie.
 *
 * También lo que dice la app del tipo: `src/types/database.ts` se escribió a mano en el PR (sin
 * `db:types` en el CI), y aquí se compara con el enum de la base, que es la lectura independiente.
 */
describe('reglas_regimen_interno fuera del tipo de autorización (4b-3)', () => {
  let centro: TestCentro
  let admin: TestUser
  const creadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Normas Fuera')
    admin = await createTestUser({ nombre: 'Admin Normas Fuera' })
    await asignarRol(admin.id, centro.id, 'admin')
  })

  afterAll(async () => {
    if (creadas.length) await serviceClient.from('autorizaciones').delete().in('id', creadas)
    if (centro) await deleteTestCentro(centro.id)
    if (admin) await deleteTestUser(admin.id)
  })

  const plantilla = async (tipo: string) => {
    const { data, error } = await (
      await clientFor(admin)
    )
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        // El tipo como texto: el de normas ya no compila, y lo que se mide es la base.
        tipo: tipo as 'autorizacion_imagenes',
        es_plantilla: true,
        titulo: `Plantilla ${tipo}`,
        texto: 'PENDIENTE',
        texto_version: 'v0-pendiente',
        texto_definitivo: false,
        estado: 'borrador',
        firmantes_requeridos: 'uno_principal',
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    if (data) creadas.push(data.id)
    return error ? error.code : 'ok'
  }

  it('el enum de la base es el que dice la app, sin reglas_regimen_interno', () => {
    const enLaBase = comoPostgres('SELECT enum_range(NULL::public.tipo_autorizacion)::text;')
    expect(enLaBase).toBe('{salida,medicacion,recogida,autorizacion_imagenes}')
    expect(`{${Constants.public.Enums.tipo_autorizacion.join(',')}}`).toBe(enLaBase)
  })

  it('premisa y control: la admin del centro crea la plantilla de imagen', async () => {
    expect(await plantilla('autorizacion_imagenes')).toBe('ok')
  })

  it('nadie crea una de normas: el valor no existe (22P02), tampoco para el servidor', async () => {
    expect(await plantilla('reglas_regimen_interno')).toBe('22P02')
    const { error } = await serviceClient.from('autorizaciones').insert({
      centro_id: centro.id,
      tipo: 'reglas_regimen_interno' as 'autorizacion_imagenes',
      es_plantilla: true,
      titulo: 'Plantilla del servidor',
      texto: 'PENDIENTE',
      texto_version: 'v0-pendiente',
      texto_definitivo: false,
      estado: 'borrador',
      firmantes_requeridos: 'uno_principal',
      creado_por: admin.id,
    })
    expect(error?.code).toBe('22P02')
  })

  it('nada en la base lo nombra: ni políticas, ni CHECK, ni funciones', () => {
    expect(
      comoPostgres(`SELECT
        (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%reglas_regimen_interno%')
        + (SELECT count(*) FROM pg_constraint WHERE pg_get_constraintdef(oid) LIKE '%reglas_regimen_interno%')
        + (SELECT count(*) FROM pg_proc WHERE prosrc LIKE '%reglas_regimen_interno%');`)
    ).toBe('0')
  })
})
