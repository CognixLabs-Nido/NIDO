import { describe, expect, it } from 'vitest'

import { SECCIONES_EXPORT } from '@/features/export/lib/columnas-export'
import { SECCIONES_RECOLECTAR } from '@/features/export/lib/columnas-recolectar'

import { columnasDeLaBase, columnasVivas } from './columnas-vivas'

// Carga el setup de los tests de RLS: comprueba que la BD es la local del CI, no una remota.
import './setup'

/**
 * La red del export art. 15, contra la base de verdad: las columnas vivas de cada tabla del export
 * son exactamente las del catálogo (`columnas-export.ts`). El tipo del catálogo sale de
 * `src/types/database.ts`, generado desde producción (`npm run db:types`; la CI lo compara con lo
 * que generan las migraciones). Si se queda atrás de una migración, aquí salta la columna que nadie
 * decidió.
 *
 * Las columnas vivas, de la descripción OpenAPI de PostgREST con la clave de servicio: es el
 * esquema que sirve la API, sin leer ninguna fila (`columnas-vivas.ts`, que comparten las listas
 * cerradas de los tests de purga).
 */

describe('la red del export: el catálogo y las columnas vivas', () => {
  it('cada tabla del export tiene en el catálogo exactamente sus columnas vivas', async () => {
    const vivas = await columnasVivas()
    // Premisa: la descripción trae el esquema entero, con las tablas del export dentro.
    expect(Object.keys(vivas).length).toBeGreaterThan(50)
    expect(vivas.recibos).toContain('total_centimos')

    for (const [ruta, s] of Object.entries(SECCIONES_EXPORT)) {
      expect(vivas[s.tabla], `${ruta}: la tabla ${s.tabla} no está en la base`).toBeDefined()
      expect(Object.keys(s.columnas).sort(), ruta).toEqual(vivas[s.tabla])
    }
  })

  it('cada tabla que lee recolectar.ts tiene en el catálogo exactamente sus columnas vivas', async () => {
    // La mitad de la app (`columnas-recolectar.ts`): pide las columnas una a una, así que una
    // columna nueva que los tipos no tengan no sale, y aquí salta sin decidir.
    const vivas = await columnasVivas()
    expect(vivas.ninos).toContain('familia_id')

    let deLaBase = 0
    for (const [ruta, s] of Object.entries(SECCIONES_RECOLECTAR)) {
      let cols = vivas[s.tabla]
      if (!cols) {
        // Solo vale si la API no la describe porque el servicio no la lee, y la tabla existe.
        const b = columnasDeLaBase(s.tabla)
        expect(b.servicioLee, `${ruta}: ${s.tabla} falta en la API y el servicio sí la lee`).toBe(
          false
        )
        expect(
          b.columnas.length,
          `${ruta}: la tabla ${s.tabla} no está en la base`
        ).toBeGreaterThan(0)
        cols = b.columnas
        deLaBase++
      }
      expect(Object.keys(s.columnas).sort(), ruta).toEqual(cols)
    }
    // Premisa: hoy, las dos secciones de las firmas de documentos (3b) salen del catálogo de la base.
    expect(deLaBase).toBe(2)
  })
})
