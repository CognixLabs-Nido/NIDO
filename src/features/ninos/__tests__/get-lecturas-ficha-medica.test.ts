import { describe, expect, it, vi } from 'vitest'

/**
 * Lo que devuelve `lecturas_ficha_medica` llega a la app sin nombre en dos casos que no son lo
 * mismo (20261217120000): el nombre que no se da a un tutor (`nombre_oculto`) y la cuenta que ya
 * no existe. La pantalla y el imprimible dicen el rol en el primero y «cuenta borrada» en el
 * segundo; si la query los confundiera, la familia leería que la profe ya no existe.
 */

let filas: Array<Record<string, unknown>> = []
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: async () => ({ data: filas, error: null }) }),
}))

const { getLecturasFichaMedica } = await import('../queries/get-lecturas-ficha-medica')

const BASE = { leida_en: '2026-07-15T10:30:00Z', origen: 'ficha', campos: [] }

describe('getLecturasFichaMedica: quién leyó', () => {
  it('distingue el nombre, el nombre oculto y la cuenta borrada', async () => {
    filas = [
      { ...BASE, lector_nombre: 'Tutora Demo', nombre_oculto: false, rol_lector: 'tutor_legal' },
      { ...BASE, lector_nombre: null, nombre_oculto: true, rol_lector: 'profe' },
      { ...BASE, lector_nombre: null, nombre_oculto: false, rol_lector: 'directora' },
    ]
    const r = await getLecturasFichaMedica('nino-1')
    // Premisa: se ha leído el registro, con sus tres filas.
    expect(r.tipo).toBe('ok')
    if (r.tipo !== 'ok') return
    expect(r.lecturas.map((l) => l.lector)).toEqual([
      { tipo: 'nombre', nombre: 'Tutora Demo' },
      { tipo: 'oculto' },
      { tipo: 'cuenta_borrada' },
    ])
  })
})
