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
 * El alta no guarda lo que no pudo leer (2026-11-11). El guardado del paso del menor manda SIEMPRE
 * todos sus campos, con «vacío = no tiene»; si la lectura de la ficha de gestión fallaba, el
 * formulario abría con esos campos vacíos y guardar los dejaba a null, con el aviso de guardado
 * (medido antes del arreglo: DNI, observaciones, la dirección y «cómo nos conoció»). Se monta la
 * cadena entera: la PÁGINA real con el fallo metido solo en `ficha_gestion_ninos`, el formulario
 * real con lo que ella le da, las acciones reales con la sesión real del tutor legal, y la fila
 * leída después. Lo que se afirma es la fila, no cómo se evita: si la página se pinta, se guarda.
 *
 * Solo el alta pendiente: en la validada (`?editar=1`) el guardado lo rechaza hoy otra puerta
 * (`no_autorizado`), y un test ahí estaría verde con o sin este arreglo.
 */
const sesion = vi.hoisted(() => ({
  actual: null as SupabaseClient<Database> | null,
  falla: false,
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
          if (fn === 'ficha_gestion_ninos' && sesion.falla) {
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
const { PasoMenor } = await import('@/features/alta/components/PasoMenor')

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

const LLENA = {
  dni: '12345678Z',
  observaciones_familia: 'MARCA-OB',
  direccion_calle: 'Calle Marca',
  direccion_numero: '7',
  direccion_cp: '46001',
  direccion_ciudad: 'Valencia',
  direccion_provincia: 'Valencia',
  como_nos_conocio: 'recomendacion',
  estado_civil_familia: 'casados',
  notas_admin: 'MARCA-NA',
  hermanos_total: 2,
  hermanos_lugar: 1,
  lugar_nacimiento: 'Lugar Marca',
  nacionalidad: 'española',
} as const

describe('el alta no guarda lo que no pudo leer', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let libro: string
  let matricula: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Alta No Pisa')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Alta No Pisa')
    matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Alta No Pisa' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal')
    // La ruta del libro, la de este niño (`ninos_validar_rutas_trg`); no hace falta el fichero.
    libro = `${centro.id}/${nino.id}/libro-marca.pdf`
    sesion.actual = await clientFor(legal)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  afterEach(() => {
    sesion.falla = false
  })

  /** El alta pendiente (la de `matricular` nace `activa`) y la ficha llena otra vez. */
  async function montar() {
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
    const { error } = await serviceClient
      .from('ninos')
      .update({ ...LLENA, libro_familia_path: libro })
      .eq('id', nino.id)
    if (error) throw new Error(`llenar la ficha: ${error.message}`)
    const { data: e } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('id', matricula)
      .single()
    expect(e?.estado).toBe('pendiente') // premisa: el alta está sin validar
    toast.success.mockClear()
    toast.error.mockClear()
  }

  async function pagina() {
    return AltaTutorPage({
      params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
      searchParams: Promise.resolve({}),
    })
  }

  /** Pinta el paso del menor con lo que la página le da, rellena lo obligatorio y guarda. */
  async function guardarPasoMenor(p: PropsAsistente) {
    render(
      createElement(PasoMenor, {
        locale: p.locale,
        ninoId: p.ninoId,
        ninoNombre: p.ninoNombre,
        identidadInicial: p.identidadInicial,
        mostrarComoNosConocio: p.mostrarComoNosConocio,
        direccionInicial: p.direccionInicial,
        datosPedagogicosInicial: p.datosPedagogicosInicial,
        libroFamiliaUrl: p.libroFamiliaUrl,
        fotoInicialUrl: p.fotoInicialUrl,
        imagenPanel: p.imagenPanel,
        imagenSinPlantilla: p.imagenSinPlantilla,
        imagenAceptado: p.imagenAceptado,
        puedeConsentirImagen: p.puedeConsentirImagen,
        currentUserId: p.currentUserId,
        currentUserNombre: p.currentUserNombre,
        modoDireccion: p.modoDireccion,
        onDireccionChange: () => undefined,
        onNext: () => undefined,
        onBack: () => undefined,
      })
    )
    const total = screen.queryByLabelText('menor.hermanos_total') as HTMLInputElement | null
    if (total && total.value === '') {
      fireEvent.change(total, { target: { value: '2' } })
      fireEvent.change(screen.getByLabelText('menor.hermanos_lugar'), { target: { value: '1' } })
    }
    fireEvent.click(screen.getByText('menor.guardar_datos'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
  }

  async function filaIntacta() {
    const { data: fila, error } = await serviceClient
      .from('ninos')
      .select([...Object.keys(LLENA), 'libro_familia_path'].join(', '))
      .eq('id', nino.id)
      .single()
    if (error || !fila) throw new Error(`leer la fila: ${error?.message}`)
    for (const [col, valor] of Object.entries({ ...LLENA, libro_familia_path: libro }))
      expect.soft((fila as unknown as Record<string, unknown>)[col], col).toBe(valor)
  }

  it('control: sin fallo, la página da lo guardado, y guardar escribe y lo conserva', async () => {
    await montar()
    const p = buscarProps(await pagina())
    if (!p) throw new Error('la página no montó el asistente')
    expect(p.identidadInicial.dni).toBe(LLENA.dni)
    expect(p.direccionInicial.direccion_calle).toBe(LLENA.direccion_calle)
    // El guardado corre de verdad (si no, «la fila sigue igual» no diría nada abajo).
    await guardarPasoMenor(p)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('identidad.guardado')
    await filaIntacta()
  })

  it('con la lectura de la ficha de gestión fallida, la ficha guardada sigue entera', async () => {
    await montar()
    sesion.falla = true
    sesion.llamadasFallidas = 0
    const r = await pagina().then(
      (el) => ({ el }),
      (e: unknown) => ({ e })
    )
    expect(sesion.llamadasFallidas).toBeGreaterThan(0) // premisa: el fallo se metió
    if ('el' in r) {
      // La página se pintó: el tutor guarda lo que ve.
      const p = buscarProps(r.el)
      if (!p) throw new Error('la página no montó el asistente')
      await guardarPasoMenor(p)
    } else {
      // No se pinta un formulario sobre lo que no se leyó.
      expect(String(r.e)).toContain('no se pudo leer')
    }
    await filaIntacta()
  })
})
