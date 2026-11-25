import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import { propsDe, type SesionConFallos } from './lectura-fallida'
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
 * El formulario de datos pedagógicos sale EN BLANCO (C, 2026-11-24, Jose: opción B). Lactancia,
 * esfínteres y alimentación venían preseleccionadas («no aplica», «pañal completo», «omnívora») y se
 * guardaban como si alguien las hubiera elegido: guardar solo la hora de la siesta creaba un registro
 * que decía que el niño come de todo. Ahora, si nadie los toca, se guardan VACÍOS, y el ✓ del avance
 * del alta solo sale con los tres contestados.
 *
 * Por los dos caminos que escriben, con la página real y la sesión real, la acción real y la fila
 * leída después con service_role: la pestaña de Dirección y el paso del menor del alta (tutor legal).
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
const { AvanceAltaCard } = await import('@/features/matriculas/components/AvanceAltaCard')
const { pasosAlta } = await import('@/features/alta/lib/estado-alta')

type PropsAsistente = Parameters<typeof AltaTutorWizard>[0]
type PropsTab = Parameters<typeof DatosPedagogicosTab>[0]
type PropsAvance = Parameters<typeof AvanceAltaCard>[0]

const LOS_TRES = { lactancia_estado: null, control_esfinteres: null, tipo_alimentacion: null }

describe('el formulario de datos pedagógicos sale en blanco y no inventa', () => {
  let ninoTab: string
  let ninoAlta: { id: string; familia_id: string }
  let legal: TestUser
  let admin: TestUser
  let sesionLegal: SupabaseClient<Database>
  let sesionAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pedagogicos En Blanco')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    ninoTab = (await createTestNino(centro.id, 'Nino Pestana En Blanco')).id
    ninoAlta = await createTestNino(centro.id, 'Nino Alta En Blanco')
    for (const id of [ninoTab, ninoAlta.id]) {
      const matricula = await matricular(id, aula.id, curso.id)
      const m = await serviceClient
        .from('matriculas')
        .update({ estado: 'pendiente' })
        .eq('id', matricula)
      if (m.error) throw new Error(`matrícula: ${m.error.message}`)
    }
    legal = await createTestUser({ nombre: 'Legal Pedagogicos En Blanco' })
    admin = await createTestUser({ nombre: 'Admin Pedagogicos En Blanco' })
    await asignarRol(admin.id, centro.id, 'admin')
    await crearFamiliaTutor(ninoAlta.familia_id, legal.id)
    await crearVinculo(ninoAlta.id, legal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    sesionLegal = await clientFor(legal)
    sesionAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    sesion.actual = null
    await serviceClient
      .from('datos_pedagogicos_nino')
      .delete()
      .in('nino_id', [ninoTab, ninoAlta?.id])
    if (legal) await deleteTestUser(legal.id)
    if (admin) await deleteTestUser(admin.id)
  })

  afterEach(() => {
    sesion.actual = null
  })

  async function leerPed(id: string) {
    const { data, error } = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('lactancia_estado, control_esfinteres, tipo_alimentacion, siesta_horario_habitual')
      .eq('nino_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw new Error(`leer pedagógicos: ${error.message}`)
    return data
  }

  async function teclearSiesta() {
    const campo = (await screen.findByLabelText(
      'fields.siesta_horario_habitual'
    )) as HTMLInputElement
    fireEvent.change(campo, { target: { value: '13:00' } })
  }

  async function paginaAdmin(id: string) {
    sesion.actual = sesionAdmin
    return AdminNinoPage({
      params: Promise.resolve({ locale: 'es', id }),
      searchParams: Promise.resolve({ tab: 'pedagogico' }),
    } as never)
  }

  it('Dirección: guardar solo la siesta deja los tres vacíos, y el avance del alta no pone ✓', async () => {
    expect(await leerPed(ninoTab), 'premisa: el niño no tiene registro').toBeNull()
    const tab = propsDe<PropsTab>(await paginaAdmin(ninoTab), DatosPedagogicosTab)
    expect(tab, 'premisa: la página pinta la pestaña').not.toBeNull()
    expect(tab!.initial, 'premisa: sin registro, sin valores de partida').toBeNull()

    render(createElement(DatosPedagogicosTab, tab!))
    fireEvent.click(screen.getByText('vacio_cta'))
    // Las tres salen sin nada elegido: el desplegable enseña «sin contestar».
    expect(screen.getAllByText('sin_contestar')).toHaveLength(3)
    await teclearSiesta()
    fireEvent.click(screen.getByText('guardar'))
    await waitFor(
      () =>
        expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 30_000 }
    )
    expect(toast.error, 'el guardado no falla').not.toHaveBeenCalled()

    const fila = await leerPed(ninoTab)
    expect(fila?.siesta_horario_habitual, 'premisa: el guardado corrió').toBe('13:00')
    expect(fila, 'nadie las tocó: se guardan vacías').toMatchObject(LOS_TRES)

    const avance = propsDe<PropsAvance>(await paginaAdmin(ninoTab), AvanceAltaCard)
    expect(avance, 'premisa: la ficha pinta el avance del alta').not.toBeNull()
    expect(avance!.pedagogicos, 'una fila con solo la siesta no es ✓').toBe(false)
  })

  it('el ✓ sale con los tres contestados', async () => {
    const { error } = await serviceClient
      .from('datos_pedagogicos_nino')
      .update({
        lactancia_estado: 'finalizada',
        control_esfinteres: 'transicion',
        tipo_alimentacion: 'omnivora',
      })
      .eq('nino_id', ninoTab)
    expect(error).toBeNull()
    const avance = propsDe<PropsAvance>(await paginaAdmin(ninoTab), AvanceAltaCard)
    expect(avance!.pedagogicos).toBe(true)
  })

  it('alta (tutor legal): avanzar con solo la siesta deja los tres vacíos', async () => {
    expect(await leerPed(ninoAlta.id), 'premisa: el niño no tiene registro').toBeNull()
    sesion.actual = sesionLegal
    const p = propsDe<PropsAsistente>(
      await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: ninoAlta.id }),
        searchParams: Promise.resolve({}),
      }),
      AltaTutorWizard
    )
    if (!p) throw new Error('la página no montó el asistente')
    expect(p.datosPedagogicosInicial, 'premisa: sin valores de partida').toBeNull()
    const i = pasosAlta(p.centroTieneCid, p.centroTieneServicios, p.cursoTieneGastos).indexOf(
      'menor'
    )
    expect(i).toBeGreaterThan(0)
    render(createElement(AltaTutorWizard, { ...p, pasoInicial: i }))
    await teclearSiesta()
    fireEvent.click(screen.getByText('wizard.siguiente'))
    await waitFor(
      async () => expect((await leerPed(ninoAlta.id))?.siesta_horario_habitual).toBe('13:00'),
      { timeout: 30_000 }
    )
    expect(await leerPed(ninoAlta.id), 'nadie las tocó: se guardan vacías').toMatchObject(LOS_TRES)
  })
})
