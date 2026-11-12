import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

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
 * SONDA (no se mergea). M2–M4: ¿pisan lo que no pudieron leer el paso del menor del alta (datos
 * pedagógicos), el paso del tutor 1 del alta (perfil del titular) y la pestaña pedagógica de la ficha
 * de Dirección? Predicciones escritas antes: ~/nido-logs/agujero/paginas-sonda/predicciones.md.
 * La PÁGINA real con la sesión real, el componente real con lo que ella le da, la acción real, y la
 * fila leída después con service_role. La lectura falla SOLO al pintar; el guardado va sin fallo.
 * Los asertos afirman la fila INTACTA: un rojo es la medida de que pisa.
 */
const sesion = vi.hoisted(() => ({
  actual: null as SupabaseClient<Database> | null,
  fallaTabla: null as string | null,
  lecturasFallidas: 0,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    const real = sesion.actual
    const res = {
      data: null,
      error: { message: 'fallo simulado', code: 'XX000', details: '', hint: '' },
      count: null,
      status: 500,
      statusText: 'simulado',
    }
    // Una cadena de PostgREST que acaba en error, sea cual sea el método al que se llame.
    const fallida = (): object => {
      const p: object = new Proxy(
        {},
        {
          get(_t, k) {
            if (k === 'then') {
              sesion.lecturasFallidas++
              return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
                Promise.resolve(res).then(ok, ko)
            }
            return () => p
          },
        }
      )
      return p
    }
    return new Proxy(real, {
      get(t, p, r) {
        if (p !== 'from') return Reflect.get(t, p, r)
        return (tabla: string) => (tabla === sesion.fallaTabla ? fallida() : t.from(tabla as never))
      },
    })
  },
}))
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

function buscar<P>(n: unknown, tipo: unknown): P | null {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n)) {
    for (const x of n) {
      const r = buscar<P>(x, tipo)
      if (r) return r
    }
    return null
  }
  const el = n as ReactElement<{ children?: unknown }>
  if (el.type === tipo) return el.props as unknown as P
  return buscar<P>(el.props?.children, tipo)
}

const PED = {
  lactancia_estado: 'materna',
  lactancia_observaciones: 'Toma a demanda',
  control_esfinteres: 'transicion',
  siesta_observaciones: 'Duerme con chupete',
} as const
const TITULAR = {
  nombre_completo: 'Nombre Guardado Titular',
  direccion_calle: 'Calle Demo 1',
  direccion_cp: '28001',
  direccion_ciudad: 'Ciudad Demo',
} as const

describe('SONDA · M2–M4: pedagógicos y perfil del titular, con la lectura fallida', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let admin: TestUser
  let sesionLegal: SupabaseClient<Database>
  let sesionAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sonda Ped Tutor')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Sonda Ped Tutor')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Sonda Ped Tutor' })
    admin = await createTestUser({ nombre: 'Admin Sonda Ped Tutor' })
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
  }

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

  async function guardarTitular() {
    const { error } = await serviceClient
      .from('familia_tutores')
      .update({ ...TITULAR, direccion_numero: null })
      .eq('familia_id', nino.familia_id)
      .eq('rol_familia', 'titular')
    if (error) throw new Error(`titular: ${error.message}`)
    expect(await leerTitular()).toMatchObject(TITULAR) // premisa: lo guardado está
  }

  async function leerTitular() {
    const { data, error } = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad')
      .eq('familia_id', nino.familia_id)
      .eq('rol_familia', 'titular')
      .is('deleted_at', null)
      .single()
    if (error) throw new Error(`leer titular: ${error.message}`)
    return data
  }

  async function asistente(falla: string | null): Promise<PropsAsistente> {
    sesion.actual = sesionLegal
    sesion.fallaTabla = falla
    sesion.lecturasFallidas = 0
    const p = buscar<PropsAsistente>(
      await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
        searchParams: Promise.resolve({}),
      }),
      AltaTutorWizard
    )
    if (falla) expect(sesion.lecturasFallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    if (!p) throw new Error('la página no montó el asistente')
    toast.success.mockClear()
    toast.error.mockClear()
    return p
  }

  function pintarPaso(p: PropsAsistente, paso: 'menor' | 'tutor1') {
    const i = pasosAlta(p.centroTieneCid).indexOf(paso)
    expect(i).toBeGreaterThan(0)
    render(createElement(AltaTutorWizard, { ...p, pasoInicial: i }))
  }

  async function teclear(label: string, valor: string) {
    const campo = (await screen.findByLabelText(label)) as HTMLInputElement
    fireEvent.change(campo, { target: { value: valor } })
  }

  // ---------- M2 · alta, paso del menor, datos pedagógicos ----------

  async function m2(falla: boolean) {
    await guardarPed()
    const p = await asistente(falla ? 'datos_pedagogicos_nino' : null)
    if (falla)
      expect(p.datosPedagogicosInicial).toBeNull() // premisa: el paso no los recibe
    else expect(p.datosPedagogicosInicial).toMatchObject(PED)
    pintarPaso(p, 'menor')
    const obs = (await screen.findByLabelText(
      'fields.lactancia_observaciones'
    )) as HTMLTextAreaElement
    expect(obs.value).toBe(falla ? '' : PED.lactancia_observaciones) // premisa: lo que vio el tutor
    await teclear('fields.siesta_horario_habitual', '13:00')
    fireEvent.click(screen.getByText('wizard.siguiente'))
    // El paso no avisa al guardar bien: se espera a que la fila tenga lo tecleado.
    await waitFor(async () => expect((await leerPed())?.siesta_horario_habitual).toBe('13:00'), {
      timeout: 30_000,
    })
    const f = await leerPed()
    for (const [k, v] of Object.entries(PED))
      expect.soft((f as Record<string, unknown> | null)?.[k], k).toBe(v)
  }

  it('M2-control: con la lectura bien, el paso del menor abre con lo guardado y lo conserva', () =>
    m2(false))
  it('M2 · con la lectura de pedagógicos fallida, lo guardado sigue entero', () => m2(true))

  // ---------- M3 · alta, paso del tutor 1, perfil del titular ----------

  async function m3(falla: boolean) {
    await guardarTitular()
    const p = await asistente(falla ? 'familia_tutores' : null)
    if (falla)
      expect(p.datosTutor1?.direccion_calle ?? null).toBeNull() // premisa
    else expect(p.datosTutor1).toMatchObject(TITULAR)
    pintarPaso(p, 'tutor1')
    const calle = (await screen.findByLabelText('menor.direccion_calle')) as HTMLInputElement
    expect(calle.value).toBe(falla ? '' : TITULAR.direccion_calle) // premisa: lo que vio el tutor
    await teclear('menor.direccion_numero', '7')
    fireEvent.click(screen.getByText('wizard.guardar_siguiente'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    expect(toast.error).not.toHaveBeenCalled() // premisa: el guardado corrió
    const f = await leerTitular()
    expect(f.direccion_numero).toBe('7') // premisa: lo tecleado llegó
    for (const [k, v] of Object.entries(TITULAR))
      expect.soft((f as Record<string, unknown>)[k], k).toBe(v)
  }

  it('M3-control: con la lectura bien, el paso del tutor abre con lo guardado y lo conserva', () =>
    m3(false))
  it('M3 · con la lectura de familia_tutores fallida, el perfil sigue entero', () => m3(true))

  // ---------- M4 · ficha de Dirección, pestaña pedagógica ----------

  async function m4(falla: boolean) {
    await guardarPed()
    sesion.actual = sesionAdmin
    sesion.fallaTabla = falla ? 'datos_pedagogicos_nino' : null
    sesion.lecturasFallidas = 0
    const tab = buscar<PropsTab>(
      await AdminNinoPage({
        params: Promise.resolve({ locale: 'es', id: nino.id }),
        searchParams: Promise.resolve({ tab: 'pedagogico' }),
      } as never),
      DatosPedagogicosTab
    )
    if (falla) expect(sesion.lecturasFallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    if (!tab) throw new Error('la página no montó la pestaña pedagógica')
    if (falla) expect(tab.initial).toBeNull()
    else expect(tab.initial).toMatchObject(PED)
    toast.success.mockClear()
    toast.error.mockClear()
    render(createElement(DatosPedagogicosTab, tab))
    if (falla) fireEvent.click(screen.getByText('vacio_cta'))
    const obs = (await screen.findByLabelText(
      'fields.lactancia_observaciones'
    )) as HTMLTextAreaElement
    expect(obs.value).toBe(falla ? '' : PED.lactancia_observaciones) // premisa: lo que vio Dirección
    await teclear('fields.siesta_horario_habitual', '13:00')
    fireEvent.click(screen.getByText('guardar'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    expect(toast.success).toHaveBeenCalled() // premisa: el guardado corrió
    const f = await leerPed()
    expect(f?.siesta_horario_habitual).toBe('13:00')
    for (const [k, v] of Object.entries(PED))
      expect.soft((f as Record<string, unknown> | null)?.[k], k).toBe(v)
  }

  it('M4-control: con la lectura bien, la pestaña abre con lo guardado y lo conserva', () =>
    m4(false))
  it('M4 · con la lectura de pedagógicos fallida, lo guardado sigue entero', () => m4(true))
})
