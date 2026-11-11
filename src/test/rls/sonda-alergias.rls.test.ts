import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
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
 * SONDA (no va a main, 2026-11-11): ¿pisa el alta la ficha médica que no pudo leer? Fallo metido solo
 * en `get_info_medica_emergencia`; página real, PasoMedico real (variante emergencia), acción real,
 * sesión real del tutor legal; la ficha se lee después con la sesión real. Predicciones en
 * ~/nido-logs/agujero/alergias/predicciones.md.
 */
const sesion = vi.hoisted(() => ({
  actual: null as SupabaseClient<Database> | null,
  falla: false,
  fn: 'get_info_medica_emergencia',
  llamadasFallidas: 0,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    const real = sesion.actual
    return new Proxy(real, {
      get(t, p, r) {
        if (p !== 'rpc') return Reflect.get(t, p, r)
        return (fn: string, args?: unknown, opts?: unknown) => {
          if (fn === sesion.fn && sesion.falla) {
            sesion.llamadasFallidas++
            return Promise.resolve({
              data: null,
              error: { message: 'fallo simulado', code: 'XX000', details: '', hint: '' },
              count: null,
              status: 500,
              statusText: 'simulado',
            })
          }
          // @ts-expect-error -- reenvío genérico a la rpc real
          return t.rpc(fn, args, opts)
        }
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
vi.mock('@/features/datos-pedagogicos/components/DatosPedagogicosForm', () => ({
  DatosPedagogicosForm: () => null,
}))
vi.mock('@/features/ninos/components/SubirFotoNino', () => ({ SubirFotoNino: () => null }))
vi.mock('@/features/alta/components/SubirDocumentoPdf', () => ({ SubirDocumentoPdf: () => null }))
vi.mock('@/features/alta/components/AcuseAltaCheckbox', () => ({ AcuseAltaCheckbox: () => null }))

const { default: AltaTutorPage } = await import('@/app/[locale]/alta/[ninoId]/page')
const { AltaTutorWizard } = await import('@/features/alta/components/AltaTutorWizard')
const { PasoMedico } = await import('@/features/alta/components/PasoMedico')

type PropsAsistente = Parameters<typeof AltaTutorWizard>[0]

function buscarProps(n: unknown): PropsAsistente | null {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n)) {
    for (const x of n) {
      const r = buscarProps(x)
      if (r) return r
    }
    return null
  }
  const el = n as ReactElement<{ children?: unknown }>
  if (el.type === AltaTutorWizard) return el.props as unknown as PropsAsistente
  return buscarProps(el.props?.children)
}

const MARCAS = {
  alergias_graves: 'MARCA-GRAVE',
  notas_emergencia: 'MARCA-NOTAS',
  medicacion_habitual: 'MARCA-MEDIC',
  alergias_leves: 'MARCA-LEVE',
  medico_familia: 'MARCA-MEDICO',
  telefono_emergencia: '600111222',
} as const

describe('SONDA alergias', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let matricula: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sonda Alergias')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Sonda Alergias')
    matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Sonda Alergias' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal')
    sesion.actual = await clientFor(legal)
    const m = await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  async function ficha() {
    const { data, error } = await sesion.actual!.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
      p_origen: 'alta',
    })
    if (error) throw new Error(`leer ficha: ${error.message}`)
    return data?.[0] ?? null
  }

  async function llenar() {
    sesion.falla = false
    const { error } = await sesion.actual!.rpc('set_info_medica_emergencia_cifrada_tutor', {
      p_nino_id: nino.id,
      p_alergias_graves: MARCAS.alergias_graves,
      p_notas_emergencia: MARCAS.notas_emergencia,
      p_medicacion_habitual: MARCAS.medicacion_habitual,
      p_alergias_leves: MARCAS.alergias_leves,
      p_medico_familia: MARCAS.medico_familia,
      p_telefono_emergencia: MARCAS.telefono_emergencia,
      p_reemplazar: true,
    })
    if (error) throw new Error(`llenar ficha: ${error.message}`)
    expect(await ficha()).toMatchObject(MARCAS) // premisa: la ficha está llena
    toast.success.mockClear()
    toast.error.mockClear()
  }

  async function props(): Promise<PropsAsistente> {
    const p = buscarProps(
      await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
        searchParams: Promise.resolve({}),
      })
    )
    if (!p) throw new Error('la página no montó el asistente')
    return p
  }

  it('P0 control: sin fallo, la página da la ficha médica', async () => {
    await llenar()
    const p = await props()
    expect(p.medicaInicial).toMatchObject(MARCAS)
  })

  async function medir(nombre: string, teclear: (s: typeof screen) => void) {
    await llenar()
    sesion.falla = true
    sesion.llamadasFallidas = 0
    const p = await props()
    sesion.falla = false
    expect(sesion.llamadasFallidas).toBeGreaterThan(0) // premisa: el fallo se metió
    expect(p.medicaInicial).toBeNull() // premisa: el formulario abre sin la ficha
    render(
      createElement(PasoMedico, {
        ninoId: nino.id,
        inicial: p.medicaInicial,
        variante: 'emergencia',
        onNext: () => undefined,
        onBack: () => undefined,
      })
    )
    teclear(screen)
    fireEvent.click(screen.getByText('wizard.guardar_siguiente'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    const f = await ficha()
    // eslint-disable-next-line no-console
    console.log(
      'SONDA-ALERGIAS',
      nombre,
      JSON.stringify({ ok: toast.success.mock.calls, err: toast.error.mock.calls, ficha: f })
    )
    for (const [k, v] of Object.entries(MARCAS))
      expect.soft((f as Record<string, unknown> | null)?.[k], `${nombre} ${k}`).toBe(v)
  }

  it('P1 guardar sin tocar', () => medir('P1', () => undefined))

  it('P2 teclear en alergias graves (que ve vacía)', () =>
    medir('P2', (s) => {
      fireEvent.change(s.getByLabelText('fields.alergias_graves'), {
        target: { value: 'NUEVA-GRAVE' },
      })
    }))

  it('P3 teclear y borrar en notas de emergencia', () =>
    medir('P3', (s) => {
      const c = s.getByLabelText('fields.notas_emergencia')
      fireEvent.change(c, { target: { value: 'x' } })
      fireEvent.change(c, { target: { value: '' } })
    }))
})
