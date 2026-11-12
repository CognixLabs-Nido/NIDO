import { describe, expect, it } from 'vitest'

import type { Database, TablesInsert, TablesUpdate } from '@/types/db'
// El generado, solo para afirmar la premisa de cada caso: que sin la capa el tipo dice otra cosa.
// eslint-disable-next-line no-restricted-imports
import type { Database as Generada } from '@/types/database'

/**
 * Lo que `src/types/db.ts` añade al generado, en tipos. Este fichero no prueba nada al ejecutarse:
 * lo prueba `tsc` (`npm run typecheck`). Cada caso va con su premisa, que también es un aserto de
 * tipos: si el generador un día supiera eso, la premisa se pone roja y la entrada de la capa sobra.
 * Que las listas de la capa cubren el catálogo entero lo prueba `tipos-overlay.rls.test.ts`.
 */

type Igual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type TodasAnulables<R> = { [K in keyof R]-?: null extends R[K] ? true : false }[keyof R]

type Fn = Database['public']['Functions']
type FnG = Generada['public']['Functions']

// 1. Columnas de una función RETURNS TABLE. Medido el 2026-11-12: `dni` NULL en los 4 niños de
// producción; el generado decía `string`.
type FichaG = FnG['ficha_gestion_ninos']['Returns'][number]
type Ficha = Fn['ficha_gestion_ninos']['Returns'][number]
const premisaFicha: Igual<FichaG['dni'], string> = true
const fichaDni: Igual<Ficha['dni'], string | null> = true
const fichaTodas: TodasAnulables<Ficha> = true

// 2. Argumentos que aceptan NULL.
const premisaArg: Igual<FnG['crear_o_anadir_a_familia']['Args']['p_usuario_id'], string> = true
const argUsuario: Igual<Fn['crear_o_anadir_a_familia']['Args']['p_usuario_id'], string | null> =
  true
const argTitulo: Igual<Fn['editar_documento_centro']['Args']['p_titulo'], string | null> = true
// Un argumento que NO está en la lista sigue sin aceptar NULL.
const argDocumento: Igual<Fn['editar_documento_centro']['Args']['p_documento_id'], string> = true

// 3. Columnas generadas: no se escriben.
type InsertNinoG = Generada['public']['Tables']['ninos']['Insert']
const premisaApellidos: Pick<InsertNinoG, 'apellidos'> = { apellidos: 'Demo' }
// @ts-expect-error `ninos.apellidos` es generada (428C9 en la base)
const insertApellidos: Pick<TablesInsert<'ninos'>, 'apellidos'> = { apellidos: 'Demo' }
// @ts-expect-error `ninos.apellidos` es generada
const updateApellidos: Pick<TablesUpdate<'ninos'>, 'apellidos'> = { apellidos: 'Demo' }
// Alias para que la declaración quepa en una línea: `@ts-expect-error` solo cubre la siguiente.
type InsertEspera = Pick<TablesInsert<'lista_espera'>, 'apellidos_nino'>
// @ts-expect-error `lista_espera.apellidos_nino` es generada
const insertApellidosNino: InsertEspera = { apellidos_nino: 'Demo' }
// Las de al lado se siguen escribiendo, y la fila se sigue leyendo.
const insertPrimer: Pick<TablesInsert<'ninos'>, 'primer_apellido'> = { primer_apellido: 'Demo' }
const filaApellidos: Igual<
  Database['public']['Tables']['ninos']['Row']['apellidos'],
  string | null
> = true

describe('la capa de tipos sobre el generado (los asertos son de tsc)', () => {
  it('cada caso compila con su premisa', () => {
    expect([
      premisaFicha,
      fichaDni,
      fichaTodas,
      premisaArg,
      argUsuario,
      argTitulo,
      argDocumento,
      filaApellidos,
    ]).toEqual(Array(8).fill(true))
    expect([
      premisaApellidos,
      insertApellidos,
      updateApellidos,
      insertApellidosNino,
      insertPrimer,
    ]).toHaveLength(5)
  })
})
