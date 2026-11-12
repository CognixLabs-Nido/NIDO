import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

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
 * El alta no guarda la ficha médica que no pudo leer (2026-11-12). El guardado de los pasos médicos
 * manda sus tres campos: `null` no toca, lo tecleado sustituye y lo borrado (`''`) vacía. Si la
 * lectura de la ficha fallaba, o se le negaba al tutor (sin `puede_ver_info_medica`), los pasos
 * abrían en blanco y lo que se tecleaba pisaba lo guardado sin que nadie lo hubiera visto (medido
 * antes del arreglo: «alergias graves» sustituida, «notas de emergencia» vaciada, con el aviso de
 * guardado). Se monta la cadena entera: la PÁGINA real, el ASISTENTE real con lo que ella le da,
 * abierto en el paso de emergencia, la acción real con la sesión real del tutor legal, y la ficha
 * leída después. Lo que se afirma es la ficha, no cómo se evita: si el paso ofrece guardar, se guarda.
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
const { pasosAlta } = await import('@/features/alta/lib/estado-alta')

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

describe('el alta no guarda la ficha médica que no pudo leer', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let vinculo: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Alta Ficha Medica')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Alta Ficha Medica')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Alta Ficha Medica' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    vinculo = await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    sesion.actual = await clientFor(legal)
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  afterEach(async () => {
    sesion.falla = false
    await permisoMedico(true)
  })

  async function permisoMedico(v: boolean) {
    const { data, error: e1 } = await serviceClient
      .from('vinculos_familiares')
      .select('permisos')
      .eq('id', vinculo)
      .single()
    if (e1 || !data) throw new Error(`vínculo: ${e1?.message}`)
    const permisos = { ...(data.permisos as Record<string, unknown>), puede_ver_info_medica: v }
    const { error } = await serviceClient
      .from('vinculos_familiares')
      .update({ permisos })
      .eq('id', vinculo)
    if (error) throw new Error(`permiso: ${error.message}`)
  }

  async function ficha() {
    const { data, error } = await sesion.actual!.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
      p_origen: 'alta',
    })
    if (error) throw new Error(`leer la ficha: ${error.message}`)
    return data?.[0] ?? null
  }

  async function llenar() {
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
    if (error) throw new Error(`llenar la ficha: ${error.message}`)
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

  /** El asistente, con lo que le da la página, abierto en el paso de emergencia. */
  function pintarEmergencia(p: PropsAsistente) {
    const i = pasosAlta(p.centroTieneCid).indexOf('emergencia')
    expect(i).toBeGreaterThan(0)
    render(createElement(AltaTutorWizard, { ...p, pasoInicial: i }))
    // premisa: el asistente está en el paso de emergencia (el botón de omitir sale siempre)
    expect(screen.getByText('medico.omitir')).toBeDefined()
  }

  /** Si el paso ofrece guardar, el tutor guarda; espera a que la acción conteste. */
  async function guardarSiSePuede(): Promise<boolean> {
    const boton =
      screen.queryByText('wizard.guardar_siguiente') ?? screen.queryByText('wizard.finalizar')
    if (!boton) return false
    fireEvent.click(boton)
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    return true
  }

  async function fichaIntacta() {
    const f = await ficha()
    for (const [k, v] of Object.entries(MARCAS))
      expect.soft((f as Record<string, unknown> | null)?.[k], k).toBe(v)
  }

  it('control: sin fallo, el paso abre con la ficha, y guardar escribe lo tecleado', async () => {
    await llenar()
    const p = await props()
    expect(p.medicaInicial).toMatchObject(MARCAS)
    pintarEmergencia(p)
    const campo = screen.getByLabelText('fields.alergias_graves') as HTMLTextAreaElement
    expect(campo.value).toBe(MARCAS.alergias_graves)
    fireEvent.change(campo, { target: { value: 'CAMBIO-VISTO' } })
    // El guardado corre de verdad (si no, «la ficha sigue igual» no diría nada abajo).
    expect(await guardarSiSePuede()).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('medico.guardado')
    expect((await ficha())?.alergias_graves).toBe('CAMBIO-VISTO')
  })

  async function medir(montarElFallo: () => Promise<void>) {
    await llenar()
    sesion.llamadasFallidas = 0
    await montarElFallo()
    const p = await props()
    // premisas: el fallo se metió (si es el simulado), y la página no tiene la ficha
    if (sesion.falla) expect(sesion.llamadasFallidas).toBeGreaterThan(0)
    sesion.falla = false
    await permisoMedico(true)
    expect(p.medicaInicial).toBeNull()
    pintarEmergencia(p)
    // Lo que haría el tutor ante un paso en blanco: escribir en uno y escribir y borrar en otro.
    const graves = screen.queryByLabelText('fields.alergias_graves')
    if (graves) fireEvent.change(graves, { target: { value: 'NUEVA-GRAVE' } })
    const notas = screen.queryByLabelText('fields.notas_emergencia')
    if (notas) {
      fireEvent.change(notas, { target: { value: 'x' } })
      fireEvent.change(notas, { target: { value: '' } })
    }
    await guardarSiSePuede()
    await fichaIntacta()
  }

  it('con la lectura de la ficha fallida, la ficha guardada sigue entera', () =>
    medir(async () => {
      sesion.falla = true
    }))

  it('sin el permiso de ver la ficha médica, la ficha guardada sigue entera', () =>
    medir(() => permisoMedico(false)))
})
