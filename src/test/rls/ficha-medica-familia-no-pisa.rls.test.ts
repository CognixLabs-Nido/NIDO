import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { hayTestId, propsDe, type SesionConFallos } from './lectura-fallida'
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
 * La ficha del niño de la familia no guarda la ficha médica que no pudo leer (2026-11-12). El editor
 * guarda en modo reemplazar: lo tecleado sustituye y lo vacío vacía. Con la lectura fallida, o negada
 * al tutor legal sin `puede_ver_info_medica`, la página le daba al editor `null`, el mismo valor que
 * «no hay ficha», y guardar una alergia vaciaba el resto (medido en la sonda: `'Polen'` y `null`). Es
 * el caso del alta (`alta-no-pisa-ficha-medica.rls.test.ts`) en la ficha del niño. Se monta la cadena
 * entera: la PÁGINA real con la sesión real del tutor legal, el editor con lo que ella le da, la
 * acción real, y la ficha leída después. Si la página ofrece editar, se edita.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
const centro = vi.hoisted(() => ({ id: '' }))
vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  requireContextoCentro: async () => ({ centroId: centro.id }),
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

const { default: FamilyNinoPage } = await import('@/app/[locale]/family/nino/[id]/page')
const { EditarInfoMedica } = await import('@/features/ninos/components/EditarInfoMedica')

type PropsEditor = Parameters<typeof EditarInfoMedica>[0]

const GUARDADA = {
  alergias_graves: 'Cacahuete',
  notas_emergencia: 'Epipen',
  medicacion_habitual: 'Ventolin',
  alergias_leves: 'Polvo',
  medico_familia: 'Dra. Demo',
  telefono_emergencia: '600111222',
} as const

describe('la ficha del niño de la familia no guarda la ficha médica que no pudo leer', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let vinculo: string

  beforeAll(async () => {
    const c = await createTestCentro('Centro Ficha Familia No Pisa')
    centro.id = c.id
    const curso = await createTestCurso(c.id)
    const aula = await createTestAula(c.id, curso.id)
    nino = await createTestNino(c.id, 'Nino Ficha Familia No Pisa')
    await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Ficha Familia No Pisa' })
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
    sesion.fallaRpc = null
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
      p_medicacion_habitual: GUARDADA.medicacion_habitual,
      p_alergias_leves: GUARDADA.alergias_leves,
      p_medico_familia: GUARDADA.medico_familia,
      p_telefono_emergencia: GUARDADA.telefono_emergencia,
      p_reemplazar: true,
    })
    if (error) throw new Error(`llenar la ficha: ${error.message}`)
    expect(await ficha()).toMatchObject(GUARDADA) // premisa: la ficha está llena
    toast.success.mockClear()
    toast.error.mockClear()
  }

  function pagina() {
    return FamilyNinoPage({
      params: Promise.resolve({ locale: 'es', id: nino.id }),
      searchParams: Promise.resolve({}),
    })
  }

  /** El editor con lo que le da la página: teclea una alergia y guarda; espera a la acción. */
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

  async function fichaIntacta() {
    const f = await ficha()
    for (const [k, v] of Object.entries(GUARDADA))
      expect.soft((f as Record<string, unknown> | null)?.[k], k).toBe(v)
  }

  it('control: con la lectura bien, el editor abre con la ficha y guarda lo tecleado sin tocar lo demás', async () => {
    await llenar()
    const p = propsDe<PropsEditor>(await pagina(), EditarInfoMedica)
    expect(p).not.toBeNull()
    expect(p!.inicial).toMatchObject(GUARDADA)
    expect(await teclearYGuardar(p!, 'Cacahuete y polen')).toBe(GUARDADA.alergias_graves)
    expect(toast.success).toHaveBeenCalled()
    const f = await ficha()
    expect(f?.alergias_graves).toBe('Cacahuete y polen')
    expect(f?.notas_emergencia).toBe(GUARDADA.notas_emergencia)
  })

  async function medir(montarElFallo: () => Promise<void>) {
    await llenar()
    sesion.fallidas = 0
    await montarElFallo()
    const conFallo = sesion.fallaRpc !== null
    const arbol = await pagina()
    if (conFallo) expect(sesion.fallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaRpc = null
    await permisoMedico(true)
    const p = propsDe<PropsEditor>(arbol, EditarInfoMedica)
    if (p) await teclearYGuardar(p, 'Polen')
    else expect.soft(hayTestId(arbol, 'ficha-medica-no-leida'), 'aviso de no leída').toBe(true)
    await fichaIntacta()
  }

  it('M1 · con la lectura de la ficha fallida, la ficha guardada sigue entera', () =>
    medir(async () => {
      sesion.fallaRpc = 'get_info_medica_emergencia'
    }))

  it('M1b · sin el permiso de ver la ficha médica, la ficha guardada sigue entera', () =>
    medir(async () => {
      await permisoMedico(false)
      // premisa: sin el permiso, la base le niega la lectura al tutor legal
      const { error } = await sesion.actual!.rpc('get_info_medica_emergencia', {
        p_nino_id: nino.id,
        p_origen: 'ficha',
      })
      expect(error).not.toBeNull()
    }))
})
