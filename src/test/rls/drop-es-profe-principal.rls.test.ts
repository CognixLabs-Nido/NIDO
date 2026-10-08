import { describe, expect, it } from 'vitest'

import { serviceClient } from './setup'

/**
 * 20261008120000 borra `profes_aulas.es_profe_principal` (deprecated desde F5B-#34; la
 * semántica la lleva `tipo_personal_aula`). Tras aplicarla, pedir la columna da 42703
 * (columna inexistente) y la tabla se sigue leyendo con sus columnas vivas.
 *
 * Gateado (la migración la aplica Jose a mano): ES_PROFE_PRINCIPAL_DROP_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.ES_PROFE_PRINCIPAL_DROP_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('profes_aulas sin es_profe_principal', () => {
  it('la columna ya no existe', async () => {
    const { error } = await serviceClient.from('profes_aulas').select('es_profe_principal').limit(1)
    expect(error?.code).toBe('42703')
  })

  it('las columnas vivas se siguen leyendo', async () => {
    const { error } = await serviceClient
      .from('profes_aulas')
      .select('id, profe_id, aula_id, curso_academico_id, tipo_personal_aula, fecha_fin')
      .limit(1)
    expect(error).toBeNull()
  })
})
