import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { propsDe, type SesionConFallos } from './lectura-fallida'
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
 * El paso del tutor del alta no guarda el perfil que no pudo leer (2026-11-12). `guardarDatosTutor`
 * escribe los seis campos del perfil compartido del titular (`familia_tutores`) con `?? null`. Con la
 * lectura fallida, el paso abría con el nombre de la CUENTA y la dirección vacía, y guardar un número
 * de portal ponía ese nombre y vaciaba la calle, el código postal y la ciudad (medido en la sonda).
 * La PÁGINA real con la sesión real del tutor legal, el asistente con lo que ella le da, la acción
 * real, y la fila leída después con service_role. Si la página ofrece el paso, se guarda.
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

const TITULAR = {
  nombre_completo: 'Nombre Guardado Titular',
  direccion_calle: 'Calle Demo 1',
  direccion_cp: '28001',
  direccion_ciudad: 'Ciudad Demo',
} as const

describe('el paso del tutor del alta no guarda el perfil que no pudo leer', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Tutor Alta No Pisa')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Tutor Alta No Pisa')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Tutor Alta No Pisa' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
    sesion.actual = await clientFor(legal)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

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

  async function guardarTitular() {
    const { error } = await serviceClient
      .from('familia_tutores')
      .update({ ...TITULAR, email: legal.email, direccion_numero: null })
      .eq('familia_id', nino.familia_id)
      .eq('rol_familia', 'titular')
    if (error) throw new Error(`titular: ${error.message}`)
    expect(await leerTitular()).toMatchObject(TITULAR) // premisa: lo guardado está
    toast.success.mockClear()
    toast.error.mockClear()
  }

  async function intacto() {
    const f = await leerTitular()
    for (const [k, v] of Object.entries(TITULAR))
      expect.soft((f as Record<string, unknown>)[k], k).toBe(v)
  }

  /** La página con la sesión del tutor legal. Si no monta el asistente, devuelve por qué. */
  async function asistente(falla: boolean): Promise<PropsAsistente | Error> {
    await guardarTitular()
    sesion.fallaTabla = falla ? 'familia_tutores' : null
    sesion.fallidas = 0
    let arbol: unknown
    try {
      arbol = await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
        searchParams: Promise.resolve({}),
      })
    } catch (e) {
      arbol = e
    }
    if (falla) expect(sesion.fallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    if (arbol instanceof Error) return arbol
    const p = propsDe<PropsAsistente>(arbol, AltaTutorWizard)
    if (!p) throw new Error('la página no montó el asistente')
    return p
  }

  async function numeroYGuardar(p: PropsAsistente) {
    const i = pasosAlta(p.centroTieneCid).indexOf('tutor1')
    expect(i).toBeGreaterThan(0)
    render(createElement(AltaTutorWizard, { ...p, pasoInicial: i }))
    const numero = (await screen.findByLabelText('menor.direccion_numero')) as HTMLInputElement
    fireEvent.change(numero, { target: { value: '7' } })
    fireEvent.click(screen.getByText('wizard.guardar_siguiente'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    expect(toast.error).not.toHaveBeenCalled() // premisa: el guardado corrió
    expect((await leerTitular()).direccion_numero).toBe('7') // premisa: lo tecleado llegó
  }

  it('control: con la lectura bien, el paso abre con el perfil guardado y lo conserva', async () => {
    const p = await asistente(false)
    if (p instanceof Error) throw p
    expect(p.datosTutor1).toMatchObject(TITULAR)
    await numeroYGuardar(p)
    await intacto()
  })

  it('M3 · con la lectura de familia_tutores fallida, el perfil del titular sigue entero', async () => {
    const p = await asistente(true)
    if (p instanceof Error) {
      // No se ofrece el paso: la página no sale, y dice por qué.
      expect.soft(p.message, 'por qué no sale').toMatch(/familia_tutores/)
    } else {
      await numeroYGuardar(p)
    }
    await intacto()
  })
})
