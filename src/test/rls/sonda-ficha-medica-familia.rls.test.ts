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
 * SONDA (no se mergea). ¿El editor de la ficha médica de /family/nino/[id] pisa lo que no pudo leer?
 * Predicciones escritas antes: ~/nido-logs/agujero/paginas-sonda/predicciones.md (M1, M1b, control).
 * La PÁGINA real con la sesión real del tutor legal, el EDITOR real con lo que ella le da, la acción
 * real, y la ficha leída después. Los asertos afirman la ficha INTACTA: un rojo es la medida de que
 * pisa, y lo que se cita es lo que recibió cada `expect.soft`.
 */
const sesion = vi.hoisted(() => ({
  actual: null as SupabaseClient<Database> | null,
  falla: false,
  llamadasFallidas: 0,
  centroId: '',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    const real = sesion.actual
    return new Proxy(real, {
      get(t, p, r) {
        if (p !== 'rpc') return Reflect.get(t, p, r)
        return (fn: string, args?: unknown, opts?: unknown) => {
          if (fn === 'get_info_medica_emergencia' && sesion.falla) {
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
vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  requireContextoCentro: async () => ({ centroId: sesion.centroId }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/family',
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

const { default: FamilyNinoPage } = await import('@/app/[locale]/family/nino/[id]/page')
const { EditarInfoMedica } = await import('@/features/ninos/components/EditarInfoMedica')

type PropsEditor = Parameters<typeof EditarInfoMedica>[0]

function buscarEditor(n: unknown): PropsEditor | null {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n)) {
    for (const x of n) {
      const r = buscarEditor(x)
      if (r) return r
    }
    return null
  }
  const el = n as ReactElement<{ children?: unknown }>
  if (el.type === EditarInfoMedica) return el.props as unknown as PropsEditor
  return buscarEditor(el.props?.children)
}

const GUARDADA = { alergias_graves: 'Cacahuete', notas_emergencia: 'Epipen' } as const

describe('SONDA · el editor de la ficha médica de la familia y lo que no pudo leer', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let vinculo: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sonda Ficha Familia')
    sesion.centroId = centro.id
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Sonda Ficha Familia')
    await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Sonda Ficha Familia' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    vinculo = await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    sesion.actual = await clientFor(legal)
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
      p_origen: 'ficha',
    })
    if (error) throw new Error(`leer la ficha: ${error.message}`)
    return data?.[0] ?? null
  }

  async function llenar() {
    const { error } = await sesion.actual!.rpc('set_info_medica_emergencia_cifrada_tutor', {
      p_nino_id: nino.id,
      p_alergias_graves: GUARDADA.alergias_graves,
      p_notas_emergencia: GUARDADA.notas_emergencia,
      p_medicacion_habitual: '', // '' = NULL en el cuerpo; con reemplazar, vacía
      p_alergias_leves: '', // '' = NULL en el cuerpo; con reemplazar, vacía
      p_medico_familia: '', // '' = NULL en el cuerpo; con reemplazar, vacía
      p_telefono_emergencia: '', // '' = NULL en el cuerpo; con reemplazar, vacía
      p_reemplazar: true,
    })
    if (error) throw new Error(`llenar la ficha: ${error.message}`)
    expect(await ficha()).toMatchObject(GUARDADA) // premisa: la ficha está guardada
    toast.success.mockClear()
    toast.error.mockClear()
  }

  async function editor(): Promise<PropsEditor> {
    const p = buscarEditor(
      await FamilyNinoPage({
        params: Promise.resolve({ locale: 'es', id: nino.id }),
        searchParams: Promise.resolve({}),
      })
    )
    if (!p) throw new Error('la página no montó el editor de la ficha médica')
    return p
  }

  /** Abre el editor, teclea en alergias graves y guarda; espera a que la acción conteste. */
  async function teclearYGuardar(p: PropsEditor, valor: string) {
    render(createElement(EditarInfoMedica, p))
    fireEvent.click(screen.getByTestId('editar-info-medica-button'))
    const campo = (await screen.findByLabelText('fields.alergias_graves')) as HTMLTextAreaElement
    const visto = campo.value
    fireEvent.change(campo, { target: { value: valor } })
    fireEvent.click(screen.getByTestId('editar-info-medica-submit'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    return visto
  }

  it('control: con la lectura bien, el editor abre con lo guardado y guarda lo tecleado', async () => {
    await llenar()
    const p = await editor()
    expect(p.inicial).toMatchObject(GUARDADA)
    expect(await teclearYGuardar(p, 'Cacahuete y polen')).toBe('Cacahuete')
    expect(toast.success).toHaveBeenCalled()
    const f = await ficha()
    expect(f?.alergias_graves).toBe('Cacahuete y polen')
    expect(f?.notas_emergencia).toBe('Epipen')
  })

  async function medir(montar: () => Promise<void>) {
    await llenar()
    sesion.llamadasFallidas = 0
    await montar()
    const p = await editor()
    if (sesion.falla) expect(sesion.llamadasFallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.falla = false
    await permisoMedico(true)
    expect(p.inicial).toBeNull() // premisa: la página no le dio la ficha al editor
    const visto = await teclearYGuardar(p, 'Polen')
    expect(visto).toBe('') // premisa: el tutor no vio lo guardado
    const f = await ficha()
    expect.soft(f?.alergias_graves, 'alergias_graves').toBe(GUARDADA.alergias_graves)
    expect.soft(f?.notas_emergencia, 'notas_emergencia').toBe(GUARDADA.notas_emergencia)
  }

  it('M1 · con la lectura de la ficha fallida, la ficha guardada sigue entera', () =>
    medir(async () => {
      sesion.falla = true
    }))

  it('M1b · sin el permiso de ver la ficha médica, la ficha guardada sigue entera', () =>
    medir(() => permisoMedico(false)))
})
