// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase 1 · PR5 — las últimas acciones que leían el centro de la cookie. Un usuario
 * con roles en DOS centros (A < B por id, así que «el primero» sería A):
 *  - centro EXPLÍCITO de la página, con admin en él: plantilla de autorizaciones, campaña y
 *    plantilla de informes;
 *  - centro DEL REGISTRO: el informe (el niño), el lote (la campaña) y la lista de espera (el
 *    curso del prospecto). Ser admin en otro centro no basta.
 * `publicarAnuncio` tiene el suyo (`publicar-anuncio-centro.test.ts`).
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const USUARIO = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const PLANTILLA = '33333333-3333-4333-8333-333333333333'
const CAMPANA = '44444444-4444-4444-8444-444444444444'
const AULA = '55555555-5555-4555-8555-555555555555'
const CURSO = '66666666-6666-4666-8666-666666666666'

const st = vi.hoisted(() => ({
  roles: [] as Array<{ centro_id: string; rol: string }>,
  filas: {} as Record<string, unknown>,
  inserts: [] as Array<{ tabla: string; valores: unknown }>,
  eqs: [] as Array<[string, string, unknown]>,
  getCursoActivo: vi.fn(),
  resolverTutorPorEmail: vi.fn(),
}))

function builder(tabla: string) {
  let insertado = false
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'is', 'in', 'order', 'limit']) b[m] = () => b
  b.eq = (col: string, val: unknown) => {
    st.eqs.push([tabla, col, val])
    return b
  }
  b.insert = (valores: unknown) => {
    insertado = true
    st.inserts.push({ tabla, valores })
    return b
  }
  b.update = () => b
  b.maybeSingle = async () => ({
    data: insertado ? { id: 'nuevo' } : (st.filas[tabla] ?? null),
    error: null,
  })
  b.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      tabla === 'roles_usuario' ? { data: st.roles, error: null } : { data: null, error: null }
    )
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO } } }) },
    rpc: async () => ({ data: false, error: null }),
    from: (t: string) => builder(t),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/cursos/queries/get-cursos', () => ({ getCursoActivo: st.getCursoActivo }))
vi.mock('@/features/lista-espera/lib/resolver-tutor-email', () => ({
  resolverTutorPorEmail: st.resolverTutorPorEmail,
}))

const { crearPlantilla } = await import('@/features/autorizaciones/actions/gestionar-autorizacion')
const { abrirCampanaInforme } =
  await import('@/features/informes/actions/gestionar-campana-informe')
const { crearPlantillaInforme } =
  await import('@/features/informes/actions/gestionar-plantilla-informe')
const { crearInformeEvolucion } = await import('@/features/informes/actions/gestionar-informe')
const { publicarLoteInformes } = await import('@/features/informes/actions/publicar-lote-informes')
const { crearProspecto } = await import('@/features/lista-espera/actions/crear-prospecto')
const { resolverTutorParaProspecto } =
  await import('@/features/lista-espera/actions/resolver-tutor')

const ADMIN_EN_A = [{ centro_id: A, rol: 'admin' }]
const ADMIN_EN_A_Y_B = [
  { centro_id: A, rol: 'admin' },
  { centro_id: B, rol: 'admin' },
]
const insertsEn = (tabla: string) => st.inserts.filter((i) => i.tabla === tabla)

beforeEach(() => {
  vi.clearAllMocks()
  st.filas = {}
  st.inserts = []
  st.eqs = []
  st.getCursoActivo.mockResolvedValue({ id: CURSO })
  st.resolverTutorPorEmail.mockResolvedValue(null)
  // Premisa: «el primero por id» sería A; los casos piden B.
  expect([B, A].sort()[0]).toBe(A)
})

describe('centro explícito de la página (solo admin de ese centro)', () => {
  it('crearPlantilla: se crea en el centro EXPLÍCITO (B), no en el primero', async () => {
    st.roles = ADMIN_EN_A_Y_B
    const r = await crearPlantilla({ tipo: 'recogida', titulo: 'Recogida' }, B)
    expect(r.success).toBe(true)
    expect(insertsEn('autorizaciones')).toEqual([
      { tabla: 'autorizaciones', valores: expect.objectContaining({ centro_id: B }) },
    ])
  })

  it('crearPlantilla en un centro donde no es admin → no_autorizado, sin escribir', async () => {
    st.roles = ADMIN_EN_A
    const r = await crearPlantilla({ tipo: 'recogida', titulo: 'Recogida' }, B)
    expect(r).toEqual({ success: false, error: 'autorizaciones.errors.no_autorizado' })
    expect(st.inserts).toEqual([])
  })

  it('abrirCampanaInforme: curso activo y campaña del centro explícito', async () => {
    st.roles = ADMIN_EN_A_Y_B
    const r = await abrirCampanaInforme({ periodo: 'trimestre_1', fecha_limite: '2026-12-01' }, B)
    expect(r.success).toBe(true)
    expect(st.getCursoActivo).toHaveBeenCalledWith(B)
    expect(insertsEn('campanas_informe')[0]?.valores).toMatchObject({ centro_id: B })
  })

  it('abrirCampanaInforme sin admin en ese centro → no_autorizado, sin escribir', async () => {
    st.roles = ADMIN_EN_A
    const r = await abrirCampanaInforme({ periodo: 'trimestre_1', fecha_limite: '2026-12-01' }, B)
    expect(r).toEqual({ success: false, error: 'informes.campana.errors.no_autorizado' })
    expect(st.inserts).toEqual([])
  })

  it('crearPlantillaInforme: en el centro explícito; sin admin allí, nada', async () => {
    const input = {
      titulo: 'Trimestral',
      estructura: [{ titulo: 'Área', items: [{ texto: 'x' }] }],
    }
    st.roles = ADMIN_EN_A_Y_B
    expect((await crearPlantillaInforme(input, B)).success).toBe(true)
    expect(insertsEn('plantillas_informe')[0]?.valores).toMatchObject({ centro_id: B })

    st.inserts = []
    st.roles = ADMIN_EN_A
    const r = await crearPlantillaInforme(input, B)
    expect(r).toEqual({ success: false, error: 'informes.errors.no_autorizado' })
    expect(st.inserts).toEqual([])
  })
})

describe('centro del registro', () => {
  const informe = { nino_id: NINO, periodo: 'trimestre_1' as const, plantilla_id: PLANTILLA }

  it('crearInformeEvolucion: el centro es el del NIÑO (B)', async () => {
    st.filas.ninos = { centro_id: B }
    st.filas.plantillas_informe = { id: PLANTILLA, estructura: [], estado: 'activa', centro_id: B }
    const r = await crearInformeEvolucion(informe)
    expect(r.success).toBe(true)
    expect(st.getCursoActivo).toHaveBeenCalledWith(B)
    expect(insertsEn('informes_evolucion')[0]?.valores).toMatchObject({ centro_id: B })
  })

  it('crearInformeEvolucion con una plantilla de OTRO centro → plantilla_no_disponible', async () => {
    st.filas.ninos = { centro_id: B }
    st.filas.plantillas_informe = { id: PLANTILLA, estructura: [], estado: 'activa', centro_id: A }
    const r = await crearInformeEvolucion(informe)
    expect(r).toEqual({ success: false, error: 'informes.errors.plantilla_no_disponible' })
    expect(st.inserts).toEqual([])
  })

  it('crearInformeEvolucion de un niño que la RLS no deja leer → no_autorizado', async () => {
    const r = await crearInformeEvolucion(informe)
    expect(r).toEqual({ success: false, error: 'informes.errors.no_autorizado' })
    expect(st.inserts).toEqual([])
  })

  it('publicarLoteInformes: el aula tiene que ser del centro de la CAMPAÑA', async () => {
    st.filas.campanas_informe = {
      curso_academico_id: CURSO,
      periodo: 'trimestre_1',
      estado: 'abierta',
      centro_id: B,
    }
    const r = await publicarLoteInformes({ campana_id: CAMPANA, aula_id: AULA })
    expect(r).toEqual({ success: false, error: 'informes.campana.errors.lote_fallo' })
    expect(st.eqs).toContainEqual(['aulas', 'centro_id', B])

    // Control: con el aula en el centro de la campaña sigue adelante (sin borradores: 0).
    st.filas.aulas = { id: AULA }
    const ok = await publicarLoteInformes({ campana_id: CAMPANA, aula_id: AULA })
    expect(ok).toEqual({ success: true, data: { total: 0, publicados: 0, incompletos: 0 } })
  })

  const prospecto = {
    curso_academico_id: CURSO,
    nombre_nino: 'Niño Demo',
    apellidos_nino: 'Apellido Demo',
    fecha_nacimiento: '',
    telefono_tutor: '',
    email_tutor: 'tutor@demo.test',
    nota: '',
  }

  it('crearProspecto: el centro es el del CURSO (B); admin solo en A → forbidden', async () => {
    st.filas.cursos_academicos = { centro_id: B }
    st.roles = ADMIN_EN_A
    const r = await crearProspecto(prospecto)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
    expect(st.resolverTutorPorEmail).not.toHaveBeenCalled()

    st.roles = ADMIN_EN_A_Y_B
    await crearProspecto(prospecto)
    expect(st.resolverTutorPorEmail).toHaveBeenCalledWith(expect.anything(), 'tutor@demo.test', B)
  })

  it('resolverTutorParaProspecto: el centro es el del curso que se le pasa', async () => {
    st.filas.cursos_academicos = { centro_id: B }
    st.roles = ADMIN_EN_A
    const r = await resolverTutorParaProspecto('tutor@demo.test', CURSO)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
    expect(st.resolverTutorPorEmail).not.toHaveBeenCalled()

    st.roles = ADMIN_EN_A_Y_B
    await resolverTutorParaProspecto('tutor@demo.test', CURSO)
    expect(st.resolverTutorPorEmail).toHaveBeenCalledWith(expect.anything(), 'tutor@demo.test', B)
    expect(st.eqs).toContainEqual(['cursos_academicos', 'id', CURSO])
  })

  it('un curso que no existe o no se ve → sin_centro, sin consultar cuentas', async () => {
    st.roles = ADMIN_EN_A_Y_B
    const r = await resolverTutorParaProspecto('tutor@demo.test', CURSO)
    expect(r).toEqual({ success: false, error: 'listaEspera.errors.sin_centro' })
    expect(st.resolverTutorPorEmail).not.toHaveBeenCalled()
  })
})
