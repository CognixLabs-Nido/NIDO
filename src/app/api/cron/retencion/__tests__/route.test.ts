// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La ruta del cron de retención (20261213120000): cada pasada deja su fila en `retencion_pasadas`,
 * encuentre algo o no, con el modo (simulado si `RETENCION_DRY_RUN` no es exactamente 'false') y el
 * recuento de los doce barridos; el mismo resultado sale por `logger.warn`, que en producción sí se
 * escribe (`logger.info` no). Ni la fila ni el log llevan texto de error. Si la fila no entra, 500.
 */

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ tabla: string; fila: Record<string, unknown> }>,
  insertError: null as { message: string } | null,
  dryRuns: [] as boolean[],
  warn: [] as unknown[][],
  info: [] as unknown[][],
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => h.warn.push(a),
    info: (...a: unknown[]) => h.info.push(a),
    error: (...a: unknown[]) => h.errores.push(a),
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: string) => ({
      insert: async (fila: Record<string, unknown>) => {
        h.inserts.push({ tabla, fila })
        return { data: null, error: h.insertError }
      },
    }),
  }),
}))

const conDryRun =
  <T>(r: T) =>
  async (opts: { dryRun: boolean }) => {
    h.dryRuns.push(opts.dryRun)
    return { dryRun: opts.dryRun, ...r }
  }

vi.mock('@/features/olvido/actions/purgar-vencidos', () => ({
  purgarVencidos: async () => ({
    success: false,
    error: 'No se pudieron listar las solicitudes vencidas',
  }),
}))
vi.mock('@/features/retencion/actions/barrer-retencion', () => ({
  barrerRetencion: async (opts: { dryRun: boolean }) => {
    h.dryRuns.push(opts.dryRun)
    return {
      success: true,
      data: { dryRun: opts.dryRun, total: 0, objetosPurgados: 0, fallidos: 0, porCategoria: {} },
    }
  },
}))
vi.mock('@/features/retencion/lib/lecturas-ficha-medica', () => ({
  purgarLecturasFichaMedica: conDryRun({ lecturas: 0 }),
}))
vi.mock('@/features/retencion/lib/audit-log', () => ({ purgarAuditLog: conDryRun({ filas: 0 }) }))
vi.mock('@/features/retencion/lib/export-log', () => ({
  purgarExportLog: conDryRun({ filas: null }),
}))
vi.mock('@/features/retencion/lib/lista-espera', () => ({
  purgarListaEspera: conDryRun({ prospectos: 0 }),
}))
vi.mock('@/features/retencion/lib/operativa', () => ({
  purgarOperativa: conDryRun({ filas: null }),
}))
vi.mock('@/features/retencion/lib/expediente', () => ({
  purgarExpedientes: conDryRun({ vencidos: 0, purgados: 0, fallidos: 0 }),
}))
vi.mock('@/features/retencion/lib/firmas', () => ({
  destruirFirmas: conDryRun({ vencidos: 0, destruidas: {}, fallidos: 0 }),
}))
vi.mock('@/features/retencion/lib/cuentas', () => ({
  purgarCuentas: conDryRun({ vencidas: 0, purgadas: 0, fallidas: 0, consentimientosCuenta: 0 }),
  borrarCuentasOlvidadas: conDryRun({
    candidatas: 0,
    borradas: 0,
    esperan: 0,
    auth: { pendientes: 0, borradas: 0, fallidas: 0 },
  }),
}))
vi.mock('@/features/retencion/lib/fiscal', () => ({
  destruirFiscal: conDryRun({ vencidas: 0, destruidas: 0, fallidas: 0 }),
}))

const { GET } = await import('../route')

const CLAVES = [
  'olvido',
  'retencion',
  'lecturasFichaMedica',
  'auditLog',
  'exportLog',
  'listaEspera',
  'operativa',
  'expediente',
  'firmas',
  'cuentas',
  'fiscal',
  'cuentasOlvidadas',
]

function peticion(auth = 'Bearer secreto-de-prueba') {
  return new Request('https://nido.test/api/cron/retencion', { headers: { authorization: auth } })
}

beforeEach(() => {
  h.inserts = []
  h.insertError = null
  h.dryRuns = []
  h.warn = []
  h.info = []
  h.errores = []
  vi.stubEnv('CRON_SECRET', 'secreto-de-prueba')
  vi.stubEnv('RETENCION_DRY_RUN', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cron de retención: el registro de cada pasada', () => {
  it('premisa: sin la variable, los once barridos con modo reciben dryRun y simulan', async () => {
    expect(process.env.RETENCION_DRY_RUN).toBeUndefined()
    const res = await GET(peticion())
    expect(res.status).toBe(200)
    expect(h.dryRuns).toHaveLength(11)
    expect(h.dryRuns.every((d) => d === true)).toBe(true)
  })

  it('sin nada que borrar, deja una fila en retencion_pasadas en modo simulado con las doce claves', async () => {
    await GET(peticion())
    expect(h.inserts).toHaveLength(1)
    const { tabla, fila } = h.inserts[0]
    expect(tabla).toBe('retencion_pasadas')
    expect(fila.modo).toBe('simulado')
    expect(Object.keys(fila.recuentos as object).sort()).toEqual([...CLAVES].sort())
    // El barrido que falló con ActionResult queda como fallo, sin su texto.
    expect((fila.recuentos as Record<string, unknown>).olvido).toEqual({ fallo: true })
  })

  it("con RETENCION_DRY_RUN='false', la fila dice purgado y los barridos no simulan", async () => {
    vi.stubEnv('RETENCION_DRY_RUN', 'false')
    const res = await GET(peticion())
    expect(res.status).toBe(200)
    expect(h.dryRuns.every((d) => d === false)).toBe(true)
    expect(h.inserts[0].fila.modo).toBe('purgado')
  })

  it("cualquier otro valor de la variable simula: solo 'false' borra", async () => {
    vi.stubEnv('RETENCION_DRY_RUN', 'FALSE')
    await GET(peticion())
    expect(h.inserts[0].fila.modo).toBe('simulado')
  })

  it('el resultado sale por logger.warn, no por logger.info, con modo y recuentos y sin texto de error', async () => {
    await GET(peticion())
    expect(h.info).toHaveLength(0)
    expect(h.warn).toHaveLength(1)
    const [mensaje, json] = h.warn[0] as [string, string]
    expect(mensaje).toBe('cron retencion ejecutado')
    const log = JSON.parse(json) as Record<string, unknown>
    expect(log.modo).toBe('simulado')
    for (const c of CLAVES) expect(log).toHaveProperty(c)
    expect(json).not.toContain('No se pudieron listar')
    expect(JSON.stringify(h.inserts[0].fila)).not.toContain('No se pudieron listar')
  })

  it('si la fila no entra, contesta 500 y lo dice por logger.error', async () => {
    h.insertError = { message: 'permission denied for table retencion_pasadas' }
    const res = await GET(peticion())
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
    expect(h.errores).toHaveLength(1)
    expect(String(h.errores[0])).toContain('la pasada no quedó registrada')
  })

  it('sin el secreto no corre nada ni deja fila', async () => {
    const res = await GET(peticion('Bearer otro'))
    expect(res.status).toBe(401)
    expect(h.dryRuns).toHaveLength(0)
    expect(h.inserts).toHaveLength(0)
  })
})
