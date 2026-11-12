import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import { hayTestId, propsDe, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Los datos pedagógicos no se guardan sobre lo que no se leyó (2026-11-12). El formulario manda el
 * estado entero (`upsertDatosPedagogicos`, por `nino_id`). Con la lectura fallida abría con los
 * valores por defecto, y guardar una hora de siesta devolvía la lactancia y el control de esfínteres a
 * su defecto y vaciaba las observaciones (medido en la sonda). Por dos caminos, el mismo helper
 * (`getDatosPedagogicos`): el paso del menor del alta (tutor legal) y la pestaña pedagógica de la
 * ficha de Dirección. La PÁGINA real con la sesión real, el formulario con lo que ella le da, la
 * acción real, y la fila leída después con service_role. Si la pantalla ofrece guardar, se guarda.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/alta',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, {
      has: () => true,
      rich: (k: string) => k,
      raw: (k: string) => k,
    }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => true }),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/features/autorizaciones/components/FirmarAutorizacionPanel', () => ({
  FirmarAutorizacionPanel: () => null,
}))
vi.mock('@/features/ninos/components/SubirFotoNino', () => ({ SubirFotoNino: () => null }))
vi.mock('@/features/alta/components/SubirDocumentoPdf', () => ({ SubirDocumentoPdf: () => null }))
vi.mock('@/features/alta/components/AcuseAltaCheckbox', () => ({ AcuseAltaCheckbox: () => null }))

const { default: AltaTutorPage } = await import('@/app/[locale]/alta/[ninoId]/page')
const { default: AdminNinoPage } = await import('@/app/[locale]/admin/ninos/[id]/page')
const { AltaTutorWizard } = await import('@/features/alta/components/AltaTutorWizard')
const { DatosPedagogicosTab } =
  await import('@/features/datos-pedagogicos/components/DatosPedagogicosTab')
const { pasosAlta } = await import('@/features/alta/lib/estado-alta')

type PropsAsistente = Parameters<typeof AltaTutorWizard>[0]
type PropsTab = Parameters<typeof DatosPedagogicosTab>[0]

const PED = {
  lactancia_estado: 'materna',
  lactancia_observaciones: 'Toma a demanda',
  control_esfinteres: 'transicion',
  siesta_observaciones: 'Duerme con chupete',
} as const

describe('los datos pedagógicos no se guardan sobre lo que no se leyó', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let admin: TestUser
  let sesionLegal: SupabaseClient<Database>
  let sesionAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pedagogicos No Pisa')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Pedagogicos No Pisa')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Pedagogicos No Pisa' })
    admin = await createTestUser({ nombre: 'Admin Pedagogicos No Pisa' })
    await asignarRol(admin.id, centro.id, 'admin')
    await crearFamiliaTutor(nino.familia_id, legal.id)
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
    sesionLegal = await clientFor(legal)
    sesionAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
    if (admin) await deleteTestUser(admin.id)
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

  async function leerPed() {
    const { data, error } = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('*')
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw new Error(`leer pedagógicos: ${error.message}`)
    return data
  }

  async function guardarPed() {
    const { error } = await serviceClient.from('datos_pedagogicos_nino').upsert(
      {
        nino_id: nino.id,
        ...PED,
        siesta_horario_habitual: null,
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      },
      { onConflict: 'nino_id' }
    )
    if (error) throw new Error(`pedagógicos: ${error.message}`)
    expect(await leerPed()).toMatchObject(PED) // premisa: lo guardado está
    toast.success.mockClear()
    toast.error.mockClear()
  }

  async function intacto() {
    const f = await leerPed()
    for (const [k, v] of Object.entries(PED))
      expect.soft((f as Record<string, unknown> | null)?.[k], k).toBe(v)
  }

  async function teclearSiesta() {
    const campo = (await screen.findByLabelText(
      'fields.siesta_horario_habitual'
    )) as HTMLInputElement
    fireEvent.change(campo, { target: { value: '13:00' } })
  }

  // ---------- el paso del menor del alta (tutor legal) ----------

  async function asistente(falla: boolean) {
    await guardarPed()
    sesion.actual = sesionLegal
    sesion.fallaTabla = falla ? 'datos_pedagogicos_nino' : null
    sesion.fallidas = 0
    const p = propsDe<PropsAsistente>(
      await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
        searchParams: Promise.resolve({}),
      }),
      AltaTutorWizard
    )
    if (falla) expect(sesion.fallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    if (!p) throw new Error('la página no montó el asistente')
    const i = pasosAlta(p.centroTieneCid).indexOf('menor')
    expect(i).toBeGreaterThan(0)
    render(createElement(AltaTutorWizard, { ...p, pasoInicial: i }))
  }

  /** «Siguiente» guarda los pedagógicos si se tocaron; el paso no avisa: se espera a la fila. */
  async function siguienteYEsperar() {
    fireEvent.click(screen.getByText('wizard.siguiente'))
    await waitFor(async () => expect((await leerPed())?.siesta_horario_habitual).toBe('13:00'), {
      timeout: 30_000,
    })
  }

  it('alta, control: con la lectura bien, el paso del menor abre con lo guardado y lo conserva', async () => {
    await asistente(false)
    const obs = (await screen.findByLabelText(
      'fields.lactancia_observaciones'
    )) as HTMLTextAreaElement
    expect(obs.value).toBe(PED.lactancia_observaciones)
    await teclearSiesta()
    await siguienteYEsperar()
    await intacto()
  })

  it('M2 · alta: con la lectura de pedagógicos fallida, lo guardado sigue entero', async () => {
    await asistente(true)
    const ofrecido = screen.queryByLabelText('fields.lactancia_observaciones')
    if (ofrecido) {
      await teclearSiesta()
      await siguienteYEsperar()
    } else {
      expect
        .soft(screen.queryByTestId('pedagogicos-no-leidos'), 'aviso de no leídos')
        .not.toBeNull()
    }
    await intacto()
  })

  // ---------- la pestaña pedagógica de la ficha de Dirección ----------

  async function pestana(falla: boolean) {
    await guardarPed()
    sesion.actual = sesionAdmin
    sesion.fallaTabla = falla ? 'datos_pedagogicos_nino' : null
    sesion.fallidas = 0
    const arbol = await AdminNinoPage({
      params: Promise.resolve({ locale: 'es', id: nino.id }),
      searchParams: Promise.resolve({ tab: 'pedagogico' }),
    } as never)
    if (falla) expect(sesion.fallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    return arbol
  }

  async function guardarEnLaPestana(tab: PropsTab) {
    render(createElement(DatosPedagogicosTab, tab))
    if (!tab.initial) fireEvent.click(screen.getByText('vacio_cta'))
    await teclearSiesta()
    fireEvent.click(screen.getByText('guardar'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    expect(toast.success).toHaveBeenCalled() // premisa: el guardado corrió
  }

  it('Dirección, control: con la lectura bien, la pestaña abre con lo guardado y lo conserva', async () => {
    const tab = propsDe<PropsTab>(await pestana(false), DatosPedagogicosTab)
    expect(tab).not.toBeNull()
    expect(tab!.initial).toMatchObject(PED)
    await guardarEnLaPestana(tab!)
    expect((await leerPed())?.siesta_horario_habitual).toBe('13:00')
    await intacto()
  })

  it('M4 · Dirección: con la lectura de pedagógicos fallida, lo guardado sigue entero', async () => {
    const arbol = await pestana(true)
    const tab = propsDe<PropsTab>(arbol, DatosPedagogicosTab)
    if (tab) await guardarEnLaPestana(tab)
    else expect.soft(hayTestId(arbol, 'pedagogicos-no-leidos'), 'aviso de no leídos').toBe(true)
    await intacto()
  })
})
