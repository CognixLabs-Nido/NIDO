// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR 3 del modelo de roles — las guardas de la app con una directora. En la app la directora es
 * Dirección (`rol: 'admin'`, `es_admin` en la BD); lo exclusivo de la admin va por
 * `usuarioResponsableEn` / `esResponsableEn` (`privado.es_responsable` en la BD).
 *
 * Cada «no» de la directora lleva su ancla: la admin, con la misma entrada, sí escribe. Y antes
 * de cada «no», la premisa: con esas filas la app la reconoce como Dirección. Sin ella, un «no»
 * pasaría también si la app no la reconociera en absoluto (como antes de este PR).
 *
 * La BD sigue autorizando por RLS (lo prueban los tests de la BD del PR 2): esto prueba que la
 * app no escribe, ni llama a la RPC, ni le enseña a la directora lo que no es suyo.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const USUARIO = '11111111-1111-4111-8111-111111111111'
const CONCEPTO = '44444444-4444-4444-8444-444444444444'
const TIPO_BECA = '66666666-6666-4666-8666-666666666666'
const CURSO = '77777777-7777-4777-8777-777777777777'

const st = vi.hoisted(() => ({
  roles: [] as Array<{ centro_id: string; rol: string }>,
  /** Respuesta de `maybeSingle`/`single` por tabla; una lista se consume en orden. */
  filas: {} as Record<string, unknown>,
  rpc: vi.fn(),
  escrituras: vi.fn(),
  createServiceRoleClient: vi.fn(),
  procesarLogo: vi.fn(),
  estadoRollover: null as unknown,
}))

function siguiente(table: string) {
  const v = st.filas[table]
  if (Array.isArray(v)) return v.shift() ?? null
  return v ?? null
}

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) b[m] = () => b
  b.maybeSingle = async () => ({ data: siguiente(table), error: null })
  b.single = async () => ({ data: siguiente(table) ?? { id: 'nuevo' }, error: null })
  for (const op of ['update', 'upsert', 'insert', 'delete']) {
    b[op] = (valores?: unknown) => {
      st.escrituras(table, op, valores)
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      table === 'roles_usuario' ? { data: st.roles, error: null } : { data: null, error: null }
    )
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO } }, error: null }) },
    from: (t: string) => builder(t),
    // is_superadmin se contesta aquí: el espía solo ve las RPC de la acción.
    rpc: (fn: string, args: unknown) =>
      fn === 'is_superadmin' ? Promise.resolve({ data: false, error: null }) : st.rpc(fn, args),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: st.createServiceRoleClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/shared/lib/adjuntos/procesar-imagen', async (orig) => ({
  ...(await orig<typeof import('@/shared/lib/adjuntos/procesar-imagen')>()),
  procesarLogo: st.procesarLogo,
}))
vi.mock('@/features/pasar-de-curso/queries/get-estado-rollover', () => ({
  getEstadoRolloverCore: async () => st.estadoRollover,
}))

const { createClient } = await import('@/lib/supabase/server')
const { usuarioAdminEn } = await import('@/features/centros/contexto/roles-del-usuario')
const { proponerAsignaciones } =
  await import('@/features/cuotas-config/actions/proponer-asignaciones')
const { updateCentro } = await import('@/features/centros/actions/update-centro')
const { POST: subirLogo } = await import('@/app/[locale]/centro/logo/route')
const { guardarDatosAcreedor } = await import('@/features/remesas/actions/guardar-datos-acreedor')
const { crearConcepto } = await import('@/features/conceptos-cobro/actions/crear-concepto')
const { actualizarConcepto } =
  await import('@/features/conceptos-cobro/actions/actualizar-concepto')
const { setActivoConcepto, eliminarConcepto } =
  await import('@/features/conceptos-cobro/actions/estado-concepto')
const { guardarTarifaConceptoAnio, eliminarTarifaConceptoAnio } =
  await import('@/features/conceptos-cobro/actions/tarifa-concepto-anio')
const { crearTipoBeca, actualizarTipoBeca, eliminarTipoBeca } =
  await import('@/features/becas/actions/tipo-beca')
const { confirmarRollover } = await import('@/features/pasar-de-curso/actions/confirmar-rollover')
const { crearPlantilla } = await import('@/features/autorizaciones/actions/gestionar-autorizacion')
const { activarCurso } = await import('@/features/cursos/actions/activar-curso')
const { sendInvitation } = await import('@/features/auth/actions/send-invitation')

const DIRECTORA = [{ centro_id: A, rol: 'directora' }]
const ADMIN = [{ centro_id: A, rol: 'admin' }]

const CENTRO = {
  nombre: 'Escuela',
  direccion: 'Calle Mayor 1',
  telefono: '960000000',
  email_contacto: 'centro@example.com',
  web: null,
  idioma_default: 'es' as const,
}
const CONCEPTO_INPUT = {
  nombre: 'Cuota',
  signo: 1 as const,
  tipo_valor: 'fijo' as const,
  tipo_concepto: 'mensual' as const,
  ambito: 'nino' as const,
  aplicacion: 'manual' as const,
  importe_euros: 290,
  porcentaje: null,
  servicio: null,
  concepto_base_id: null,
  activo: true,
  tarifa_por_anio_nacimiento: false,
}
const ACREEDOR = { identificador_acreedor: 'ES12ZZZ12345678', bic_acreedor: '', iban: '' }
const ESTADO_ROLLOVER = {
  cursoDestino: { id: CURSO, nombre: '2027-28', estado: 'planificado', centroId: A },
  cursoOrigen: null,
  aulasDestino: [],
  ninosActivos: [],
  pendientes: [],
  finalizados: [],
}

function formLogo(): Request {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
  form.set('centro_id', A)
  return new Request('http://localhost/es/centro/logo', { method: 'POST', body: form })
}

/** La premisa de cada «no»: con estas filas, la app la reconoce como Dirección en A. */
async function esDireccionEnA() {
  return (await usuarioAdminEn(await createClient(), A)) === USUARIO
}

beforeEach(() => {
  vi.clearAllMocks()
  st.filas = {}
  st.rpc.mockResolvedValue({ data: 1, error: null })
  st.estadoRollover = ESTADO_ROLLOVER
  st.procesarLogo.mockRejectedValue(new Error('PASA_LA_GUARDA'))
  st.createServiceRoleClient.mockImplementation(() => {
    throw new Error('PASA_LA_GUARDA')
  })
})

describe('hace el día a día', () => {
  it('es Dirección: una acción de Dirección le llega a la RPC', async () => {
    st.roles = DIRECTORA
    expect(await esDireccionEnA()).toBe(true)
    const r = await proponerAsignaciones(A)
    expect(r.success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('proponer_asignaciones', { p_centro_id: A })
  })

  it('activa el primer curso de un centro sin curso activo', async () => {
    st.roles = DIRECTORA
    st.filas.cursos_academicos = [{ id: CURSO, centro_id: A, estado: 'planificado' }, null]
    const r = await activarCurso(CURSO)
    expect(r.success).toBe(true)
    expect(st.escrituras).toHaveBeenCalledWith('cursos_academicos', 'update', {
      estado: 'activo',
    })
  })

  it('crea una plantilla de recogida (no es legal)', async () => {
    st.roles = DIRECTORA
    st.filas.autorizaciones = { id: 'nueva' }
    const r = await crearPlantilla({ tipo: 'recogida', titulo: 'Recogida' }, A)
    expect(r.success).toBe(true)
    expect(st.escrituras).toHaveBeenCalledWith(
      'autorizaciones',
      'insert',
      expect.objectContaining({ tipo: 'recogida', es_plantilla: true })
    )
  })

  it('invita a una profe: pasa las guardas y llega al service client', async () => {
    st.roles = DIRECTORA
    await expect(
      sendInvitation({ email: 'profe@example.com', rolObjetivo: 'profe', centroId: A, aulaId: A })
    ).rejects.toThrow('PASA_LA_GUARDA')
  })
})

interface Caso {
  nombre: string
  run: () => Promise<unknown>
  error: string
  /** La escritura o la RPC que la directora no hace y la admin sí. */
  efecto: () => void
  preparar?: () => void
}

const escribe = (tabla: string, op: string) => () =>
  expect(st.escrituras.mock.calls.some(([t, o]) => t === tabla && o === op)).toBe(true)
const llama = (fn: string) => () => expect(st.rpc).toHaveBeenCalledWith(fn, expect.anything())
const concepto = () => {
  st.filas.conceptos_cobro = { centro_id: A, id: CONCEPTO }
}
const tipoBeca = () => {
  st.filas.tipos_beca = { centro_id: A, id: TIPO_BECA }
}

/** [nombre, acción, error de la directora, efecto que hace la admin, preparación]. */
const TUPLAS: ReadonlyArray<
  readonly [string, () => Promise<unknown>, string, () => void, (() => void)?]
> = [
  [
    'updateCentro',
    () => updateCentro(A, CENTRO),
    'centro.errors.no_autorizado',
    escribe('centros', 'update'),
  ],
  [
    'guardarDatosAcreedor',
    () => guardarDatosAcreedor(ACREEDOR, A),
    'remesas.errors.no_autorizado',
    llama('set_datos_acreedor'),
  ],
  [
    'crearConcepto',
    () => crearConcepto(A, CONCEPTO_INPUT),
    'conceptos_cobro.errors.no_autorizado',
    escribe('conceptos_cobro', 'insert'),
  ],
  [
    'actualizarConcepto',
    () => actualizarConcepto(CONCEPTO, CONCEPTO_INPUT),
    'conceptos_cobro.errors.no_autorizado',
    escribe('conceptos_cobro', 'update'),
    concepto,
  ],
  [
    'setActivoConcepto',
    () => setActivoConcepto(CONCEPTO, false),
    'conceptos_cobro.errors.no_autorizado',
    escribe('conceptos_cobro', 'update'),
    concepto,
  ],
  [
    'eliminarConcepto',
    () => eliminarConcepto(CONCEPTO),
    'conceptos_cobro.errors.no_autorizado',
    escribe('conceptos_cobro', 'update'),
    concepto,
  ],
  [
    'guardarTarifaConceptoAnio',
    () =>
      guardarTarifaConceptoAnio({
        concepto_id: CONCEPTO,
        anio_nacimiento: 2024,
        importe_euros: 300,
      }),
    'conceptos_cobro.errors.no_autorizado',
    escribe('tarifa_concepto_anio', 'upsert'),
    concepto,
  ],
  [
    'eliminarTarifaConceptoAnio',
    () => eliminarTarifaConceptoAnio({ concepto_id: CONCEPTO, anio_nacimiento: 2024 }),
    'conceptos_cobro.errors.no_autorizado',
    escribe('tarifa_concepto_anio', 'delete'),
    concepto,
  ],
  [
    'crearTipoBeca',
    () => crearTipoBeca(A, { nombre: 'Beca', activo: true }),
    'becas.errors.no_autorizado',
    escribe('tipos_beca', 'insert'),
  ],
  [
    'actualizarTipoBeca',
    () => actualizarTipoBeca(TIPO_BECA, { nombre: 'Beca', activo: true }),
    'becas.errors.no_autorizado',
    escribe('tipos_beca', 'update'),
    tipoBeca,
  ],
  [
    'eliminarTipoBeca',
    () => eliminarTipoBeca(TIPO_BECA),
    'becas.errors.no_autorizado',
    escribe('tipos_beca', 'update'),
    tipoBeca,
  ],
  [
    'confirmarRollover (cerrar el curso)',
    () => confirmarRollover({ curso_destino_id: CURSO }),
    'rollover.errors.no_autorizado',
    llama('cerrar_curso'),
  ],
  [
    'crearPlantilla de las normas internas',
    () => crearPlantilla({ tipo: 'reglas_regimen_interno', titulo: 'Normas' }, A),
    'autorizaciones.errors.no_autorizado',
    escribe('autorizaciones', 'insert'),
    () => {
      st.filas.autorizaciones = { id: 'nueva' }
    },
  ],
  [
    'crearPlantilla del consentimiento de imagen',
    () => crearPlantilla({ tipo: 'autorizacion_imagenes', titulo: 'Imagen' }, A),
    'autorizaciones.errors.no_autorizado',
    escribe('autorizaciones', 'insert'),
    () => {
      st.filas.autorizaciones = { id: 'nueva' }
    },
  ],
]

const EXCLUSIVAS: ReadonlyArray<Caso> = TUPLAS.map(([nombre, run, error, efecto, preparar]) => ({
  nombre,
  run,
  error,
  efecto,
  preparar,
}))

describe('no hace lo exclusivo de la admin', () => {
  it.each(EXCLUSIVAS)(
    '$nombre: la directora no escribe',
    async ({ run, error, efecto, preparar }) => {
      st.roles = DIRECTORA
      preparar?.()
      expect(await esDireccionEnA()).toBe(true)
      expect(await run()).toEqual({ success: false, error })
      expect(st.escrituras).not.toHaveBeenCalled()
      expect(st.rpc).not.toHaveBeenCalled()
      expect(() => efecto()).toThrow()
    }
  )

  it.each(EXCLUSIVAS)('$nombre: ancla, la admin sí', async ({ run, efecto, preparar }) => {
    st.roles = ADMIN
    preparar?.()
    await run()
    efecto()
  })

  it('el logo: la directora recibe 403 antes de procesar nada; la admin pasa la guarda', async () => {
    st.roles = DIRECTORA
    expect(await esDireccionEnA()).toBe(true)
    const r = await subirLogo(formLogo())
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ success: false, error: 'centro.logo.no_autorizado' })
    expect(st.procesarLogo).not.toHaveBeenCalled()

    st.roles = ADMIN
    await subirLogo(formLogo())
    expect(st.procesarLogo).toHaveBeenCalledTimes(1)
  })

  it('con un curso activo, no activa otro (lo cerraría): se le dice, sin escribir', async () => {
    st.roles = DIRECTORA
    expect(await esDireccionEnA()).toBe(true)
    st.filas.cursos_academicos = [
      { id: CURSO, centro_id: A, estado: 'planificado' },
      { id: 'activo' },
    ]
    expect(await activarCurso(CURSO)).toEqual({
      success: false,
      error: 'curso.errors.cambiar_activo_solo_admin',
    })
    expect(st.escrituras).not.toHaveBeenCalled()
  })

  it('ancla: la admin, con un curso activo, cierra el activo y activa el nuevo', async () => {
    st.roles = ADMIN
    st.filas.cursos_academicos = [
      { id: CURSO, centro_id: A, estado: 'planificado' },
      { id: 'activo' },
    ]
    expect((await activarCurso(CURSO)).success).toBe(true)
    expect(st.escrituras).toHaveBeenCalledWith('cursos_academicos', 'update', {
      estado: 'cerrado',
    })
    expect(st.escrituras).toHaveBeenCalledWith('cursos_academicos', 'update', {
      estado: 'activo',
    })
  })
})

describe('no puede escalar', () => {
  it('no invita a una admin: forbidden, sin crear el service client (que se salta la RLS)', async () => {
    st.roles = DIRECTORA
    expect(await esDireccionEnA()).toBe(true)
    expect(
      await sendInvitation({ email: 'nueva@example.com', rolObjetivo: 'admin', centroId: A })
    ).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
    expect(st.createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('ancla: la admin invita a una admin (pasa las guardas y llega al service client)', async () => {
    st.roles = ADMIN
    await expect(
      sendInvitation({ email: 'nueva@example.com', rolObjetivo: 'admin', centroId: A })
    ).rejects.toThrow('PASA_LA_GUARDA')
  })
})
