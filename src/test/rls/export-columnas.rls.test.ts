import { describe, expect, it } from 'vitest'

import { SECCIONES_EXPORT } from '@/features/export/lib/columnas-export'

// Carga el setup de los tests de RLS: comprueba que la BD es la local del CI, no una remota.
import './setup'

/**
 * La red del export art. 15, contra la base de verdad: las columnas vivas de cada tabla del export
 * son exactamente las del catálogo (`columnas-export.ts`). El tipo del catálogo sale de
 * `src/types/database.ts`, que a veces se escribe a mano: si se queda atrás de una migración, aquí
 * salta la columna que nadie decidió.
 *
 * Las columnas vivas, de la descripción OpenAPI de PostgREST con la clave de servicio: es el
 * esquema que sirve la API, sin leer ninguna fila.
 */

async function columnasVivas(): Promise<Record<string, string[]>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      Accept: 'application/openapi+json',
    },
  })
  expect(res.status).toBe(200)
  const spec = (await res.json()) as {
    definitions: Record<string, { properties: Record<string, unknown> }>
  }
  return Object.fromEntries(
    Object.entries(spec.definitions).map(([t, d]) => [t, Object.keys(d.properties).sort()])
  )
}

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
})
