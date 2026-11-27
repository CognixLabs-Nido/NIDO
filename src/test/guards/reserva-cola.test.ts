// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * B2 (2026-11-27): la reserva de un cambio de la cola vale 2 minutos en la base
 * (`reclamar_cambio_pendiente`, 20270209120000) porque la función de la página de pendientes dura como
 * mucho `maxDuration` (60 s) y una sentencia de `authenticated` en vuelo, 8 s más (`statement_timeout`,
 * leído en producción el 2026-11-27). Si alguien sube `maxDuration` sin subir la reserva, dos
 * aprobaciones podrían aplicar a la vez. Un comentario no se pone rojo: esto sí. Lee los tres sitios sin
 * comentarios (un número citado en un comentario no cuenta).
 */
const RAIZ = path.resolve(__dirname, '..', '..', '..')
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const sinComentariosTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const sinComentariosSql = (s: string) => s.replace(/--[^\n]*/g, '')

/** La última definición de `reclamar_cambio_pendiente` en las migraciones (la viva). */
function minutosDeLaReserva(): number {
  const dir = path.join(RAIZ, 'supabase', 'migrations')
  const ficheros = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let minutos: number | null = null
  for (const f of ficheros) {
    const sql = sinComentariosSql(fs.readFileSync(path.join(dir, f), 'utf8'))
    const i = sql.search(/FUNCTION\s+public\.reclamar_cambio_pendiente\s*\(/)
    if (i < 0) continue
    const cuerpo = sql.slice(i, sql.indexOf('$function$;', i))
    const m = /now\(\)\s*-\s*interval\s*'(\d+)\s*minutes?'/.exec(cuerpo)
    minutos = m ? Number(m[1]) : NaN
  }
  if (minutos === null)
    throw new Error('no hay ninguna migración que defina reclamar_cambio_pendiente')
  return minutos
}

const TOPE_SENTENCIA_S = 8

describe('la reserva de la cola cubre lo que puede durar quien la tiene', () => {
  it('maxDuration de la página + el tope por sentencia < la reserva de la base, y la pantalla la conoce', () => {
    const pagina = sinComentariosTs(leer('src/app/[locale]/admin/pendientes/page.tsx'))
    const m = /export const maxDuration\s*=\s*(\d+)/.exec(pagina)
    expect(m, 'la página de pendientes declara maxDuration').not.toBeNull()
    const maxDuration = Number(m![1])

    const minutos = minutosDeLaReserva()
    expect(Number.isFinite(minutos), 'la reserva compara con now() - interval en minutos').toBe(
      true
    )

    expect(maxDuration + TOPE_SENTENCIA_S).toBeLessThan(minutos * 60)

    const cola = sinComentariosTs(leer('src/features/cambios-pendientes/queries/get-cola.ts'))
    const r = /export const RESERVA_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(cola)
    expect(r, 'get-cola declara RESERVA_MS en minutos').not.toBeNull()
    expect(Number(r![1])).toBe(minutos)
  })
})
