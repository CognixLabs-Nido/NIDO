import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { SECCIONES_EXPORT } from '@/features/export/lib/columnas-export'
import { SECCIONES_RECOLECTAR } from '@/features/export/lib/columnas-recolectar'

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

/**
 * Una tabla sin privilegios para `service_role` no sale en la descripción de la API con la clave de
 * servicio (desde el 3b, `firmas_documentos_centro`: la sesión la lee y el servidor no). Sus columnas
 * vivas salen del catálogo de la base, por psql contra la BD del CI, y solo si ese es el motivo.
 */
function columnasDeLaBase(tabla: string): { servicioLee: boolean; columnas: string[] } {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: `SELECT has_table_privilege('service_role', 'public.${tabla}', 'SELECT')::text || '|' ||
      coalesce((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = '${tabla}'), '');`,
    encoding: 'utf8',
  }).trim()
  const [lee, cols] = salida.split('|')
  return { servicioLee: lee === 'true', columnas: cols ? cols.split(',') : [] }
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
