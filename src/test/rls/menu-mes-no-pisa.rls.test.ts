import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * El menú del mes no se guarda sobre lo que no se leyó (C, 2026-11-23). Si falla la lectura de los
 * días (`menu_dia`), `getPlantillaMes` devuelve la plantilla con `menus: []` y el editor abre el mes
 * vacío. Guardar escribe ENTERO cada día tocado (upsert por plantilla y fecha): si Dirección añade un
 * plato a un día que ya tenía menú, los otros platos de ese día se guardan vacíos. Se monta la cadena
 * entera: la PÁGINA real con la sesión real de la admin, el editor con lo que ella le da, la acción
 * real y la fila leída después. Si la pantalla ofrece guardar, se guarda.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos: con } = await import('./lectura-fallida')
  return { createClient: async () => con(sesion) }
})
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/admin/menus',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, { has: () => true, rich: (k: string) => k }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => true }),
  useLocale: () => 'es',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const accion = vi.hoisted(() => ({ llamadas: [] as Promise<unknown>[] }))
vi.mock('@/features/menus/actions/guardar-menu-mes', async (original) => {
  const m = await original<typeof import('@/features/menus/actions/guardar-menu-mes')>()
  return {
    ...m,
    guardarMenuMes: (...a: Parameters<typeof m.guardarMenuMes>) => {
      const r = m.guardarMenuMes(...a)
      accion.llamadas.push(r)
      return r
    },
  }
})

const { default: PaginaEditor } = await import('@/app/[locale]/admin/menus/[id]/page')
const { EditorMenuMensual } = await import('@/features/menus/components/EditorMenuMensual')
type PropsEditor = Parameters<typeof EditorMenuMensual>[0]

// Un miércoles de un mes futuro: lectivo por defecto, sin depender de hoy.
const ANIO = 2027
const MES = 3
const DIA = '2027-03-03'
const GUARDADO = {
  desayuno: 'Leche con cereales',
  media_manana: 'Fruta',
  comida_primero: 'Crema de calabaza',
  comida_segundo: 'Merluza al horno',
  comida_postre: 'Yogur',
  merienda: 'Bocadillo',
} as const
const NUEVO_PRIMERO = 'Lentejas estofadas'

describe('el menú del mes no se guarda sobre lo que no se leyó', () => {
  let admin: TestUser
  let centroId: string
  let plantillaId: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Menu No Pisa')
    centroId = centro.id
    admin = await createTestUser({ nombre: 'Admin Menu No Pisa' })
    await asignarRol(admin.id, centro.id, 'admin')
    const p = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({
        centro_id: centro.id,
        anio: ANIO,
        mes: MES,
        estado: 'borrador',
        creada_por: admin.id,
      })
      .select('id')
      .single()
    if (p.error || !p.data) throw new Error(`plantilla: ${p.error?.message}`)
    plantillaId = p.data.id
    sesion.actual = await clientFor(admin)
  })

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('menu_dia').delete().eq('plantilla_id', plantillaId)
    await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centroId)
    if (admin) await deleteTestUser(admin.id)
  })

  beforeEach(async () => {
    const r = await serviceClient
      .from('menu_dia')
      .upsert(
        { plantilla_id: plantillaId, fecha: DIA, ...GUARDADO },
        { onConflict: 'plantilla_id,fecha' }
      )
    if (r.error) throw new Error(`menú del día: ${r.error.message}`)
    accion.llamadas = []
    sesion.fallidas = 0
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

  async function menuDelDia() {
    const { data, error } = await serviceClient
      .from('menu_dia')
      .select('desayuno, media_manana, comida_primero, comida_segundo, comida_postre, merienda')
      .eq('plantilla_id', plantillaId)
      .eq('fecha', DIA)
      .single()
    if (error) throw new Error(`leer el menú: ${error.message}`)
    return data
  }

  /** Abre el día, cambia el primer plato, «hecho» y «guardar mes». Devuelve si se pudo guardar. */
  async function editarPrimeroYGuardar(props: PropsEditor) {
    render(createElement(EditorMenuMensual, props))
    fireEvent.click(screen.getByTestId(`menu-celda-${DIA}`))
    fireEvent.change(screen.getByTestId('menu-dia-input-dia-comida-primero'), {
      target: { value: NUEVO_PRIMERO },
    })
    fireEvent.click(screen.getByTestId('menu-dia-hecho'))
    // La lectura que falla es la de la página; el guardado va con la sesión sana.
    sesion.fallaTabla = null
    fireEvent.click(screen.getByTestId('guardar-mes'))
    await waitFor(() => expect(accion.llamadas.length).toBe(1))
    return (await accion.llamadas[0]) as { success: boolean }
  }

  it('control: con la lectura bien, cambiar el primer plato deja los otros cinco', async () => {
    const el = await PaginaEditor({ params: Promise.resolve({ locale: 'es', id: plantillaId }) })
    const props = propsDe<PropsEditor>(el, EditorMenuMensual)
    expect(props, 'premisa: la página pinta el editor').not.toBeNull()
    expect(
      props!.menus.some((m) => m.fecha === DIA),
      'premisa: el editor recibe el día'
    ).toBe(true)
    const r = await editarPrimeroYGuardar(props!)
    expect(r.success, 'premisa: el guardado corrió').toBe(true)
    expect(await menuDelDia()).toEqual({ ...GUARDADO, comida_primero: NUEVO_PRIMERO })
  })

  it('si falla la lectura de los días, no se guarda un día sobre lo que no se vio', async () => {
    sesion.fallaTabla = 'menu_dia'
    let el: unknown
    try {
      el = await PaginaEditor({ params: Promise.resolve({ locale: 'es', id: plantillaId }) })
    } catch (e) {
      el = e
    }
    expect(sesion.fallidas, 'premisa: la lectura de los días falló').toBeGreaterThan(0)
    const props = el instanceof Error ? null : propsDe<PropsEditor>(el, EditorMenuMensual)
    if (props) {
      // La pantalla ofrece editar: se edita como lo haría Dirección, y se mira la fila.
      const r = await editarPrimeroYGuardar(props)
      expect(r.success, 'premisa: el guardado corrió').toBe(true)
      const fila = await menuDelDia()
      for (const campo of [
        'desayuno',
        'media_manana',
        'comida_segundo',
        'comida_postre',
        'merienda',
      ] as const)
        expect.soft(fila[campo], `${campo} se conserva`).toBe(GUARDADO[campo])
    } else {
      // No ofrece editar: lo dice (error de la página, no un mes vacío).
      expect(el, 'la página no pinta un mes vacío: avisa').toBeInstanceOf(Error)
      expect(await menuDelDia(), 'nada se tocó').toEqual(GUARDADO)
    }
  })
})
