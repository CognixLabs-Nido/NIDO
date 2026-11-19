import { describe, expect, it } from 'vitest'

import { SECCIONES_EXPORT } from '@/features/export/lib/columnas-export'
import { SECCIONES_RECOLECTAR } from '@/features/export/lib/columnas-recolectar'

import {
  columnasUuid,
  esDePersona,
  leerColumnasUuid,
  sqlColumnasUuid,
  UUID_SIN_CLAVE,
} from './columnas-de-persona'
import { columnasDeLaBase, columnasVivas } from './columnas-vivas'
import { comoPostgres } from './documentos-centro-fixture'

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
    // Premisa: hoy, las dos secciones de las firmas de documentos (3b) y, desde la 10b-1
    // (`20270128120000`), las tres de la ficha firmada (`firmas_ficha` en las dos y
    // `refirmas_ficha`), sin privilegios para el servicio, salen del catálogo de la base.
    expect(deLaBase).toBe(5)
  })
})

/**
 * R4 («el uuid de una persona no sale»), con la clase decidida por la BASE (2026-11-19): una columna
 * es de persona si tiene clave ajena a `usuarios`, `familia_tutores` o `auth.users`
 * (`columnas-de-persona.ts`), no si su nombre casa con una lista. Hasta entonces lo miraban los tests
 * unit por el nombre, y las dos `firmas_ficha.tutor_id` (10b-3) entraron por la regla de los id
 * corrientes, en verde. Lo que el esquema no alcanza (los uuid sin clave ajena) está decidido a mano
 * en `UUID_SIN_CLAVE`, y uno nuevo sin decidir pone rojo el primer it.
 */
describe('R4 por el esquema: el uuid de una persona no sale', () => {
  type Decision = Record<string, unknown>
  const tablas = [
    ...new Set([
      ...Object.values(SECCIONES_RECOLECTAR).map((s) => s.tabla),
      ...Object.values(SECCIONES_EXPORT).map((s) => s.tabla),
    ]),
  ].sort()

  it('todo uuid sin clave ajena que no es la clave primaria está decidido, con su porqué', () => {
    const uuids = columnasUuid(tablas)
    // Premisa: la base contesta, y lo que ya se sabe de persona lo es por su clave ajena.
    expect(uuids.get('firmas_ficha.firmante_id')?.claveAPersona).toBe(true)
    expect(uuids.get('firmas_ficha.tutor_id')?.claveAPersona).toBe(true)
    expect(uuids.get('firmas_ficha.nino_id')?.claveAPersona).toBe(false)

    const sinClave = [...uuids].filter(([, u]) => u.sinClave).map(([k]) => k)
    expect(sinClave.sort(), 'uuid sin clave ajena: decídelo en UUID_SIN_CLAVE').toEqual(
      Object.keys(UUID_SIN_CLAVE).sort()
    )
    for (const [k, d] of Object.entries(UUID_SIN_CLAVE))
      expect(d.porque.trim().length, `${k}: sin porqué`).toBeGreaterThan(40)
  })

  it('recolectar.ts: una columna de persona no sale, y `rol` solo va en una de persona', () => {
    const uuids = columnasUuid(tablas)
    let personas = 0
    for (const [ruta, s] of Object.entries(SECCIONES_RECOLECTAR))
      for (const [c, d] of Object.entries(s.columnas as Record<string, Decision>)) {
        const donde = `${ruta}.${c}`
        if (esDePersona(uuids, s.tabla, c)) {
          personas++
          // Quién está vinculado al niño sale con su nombre: es su familia (la raya, 2026-11-01).
          const familia = ruta === 'nino.vinculos_familiares' && c === 'usuario_id'
          if (familia) expect('enSuLugar' in d, `R4 ${donde}`).toBe(true)
          else expect('noSale' in d || 'rol' in d, `R4 ${donde}`).toBe(true)
        } else {
          expect('rol' in d, `R4 ${donde}: rol en una columna que no es de persona`).toBe(false)
        }
      }
    // Premisa: 26 medidas en producción el 2026-11-19 (las 25 que veía el nombre y `usuarios.id`)
    // más las dos `firmas_ficha.tutor_id` de la 10b-3.
    expect(personas).toBe(28)
  })

  it('export_datos_sujeto: una columna de persona no sale, salvo algo calculado con su nota', () => {
    const uuids = columnasUuid(tablas)
    let personas = 0
    for (const [ruta, s] of Object.entries(SECCIONES_EXPORT))
      for (const [c, d] of Object.entries(s.columnas as Record<string, Decision>)) {
        if (!esDePersona(uuids, s.tabla, c)) continue
        personas++
        const donde = `${ruta}.${c}`
        if ('sale' in d) expect(d.nota, `R4 ${donde}: sale sin nota`).toBeTruthy()
        else expect('noSale' in d, `R4 ${donde}`).toBe(true)
      }
    // Premisa: 37 por su clave ajena (medidas en producción el 2026-11-19) y 5 decididas sin ella
    // (`tutores_legales` y `sujeto_id` de `olvido_solicitudes` en dos secciones; el de `export_log`).
    expect(personas).toBe(42)
  })

  it('control negativo: una columna de persona nueva, sin tocar ninguna lista, es de persona', () => {
    // Una tabla que no existe, con un nombre que ninguna lista conoce, creada y deshecha en una
    // transacción como postgres (solo la base local del CI). Si la clase saliera del nombre, no
    // entraría.
    const salida = comoPostgres(`BEGIN;
      CREATE TABLE public.sonda_r4_persona (id uuid PRIMARY KEY, quien_lo_mira uuid REFERENCES public.usuarios (id), suelto uuid);
      ${sqlColumnasUuid(['sonda_r4_persona'])}
      ROLLBACK;`)
    const u = leerColumnasUuid(salida)
    expect(u.get('sonda_r4_persona.quien_lo_mira')).toEqual({
      claveAPersona: true,
      sinClave: false,
    })
    expect(u.get('sonda_r4_persona.id')).toEqual({ claveAPersona: false, sinClave: false })
    // Y un uuid sin clave ajena se ve como tal: la guarda del primer it lo pediría decidido.
    expect(u.get('sonda_r4_persona.suelto')).toEqual({ claveAPersona: false, sinClave: true })
    // Deshecha: no queda.
    expect(comoPostgres(`SELECT to_regclass('public.sonda_r4_persona') IS NULL`)).toBe('t')
  })
})
