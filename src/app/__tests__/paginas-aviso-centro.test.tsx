import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

/**
 * Multicentro — las tres páginas que abre una notificación push (`?centro=` en el enlace):
 *  - con otro centro del usuario, la página enseña la confirmación para cambiar y NO busca el
 *    registro (que en el centro activo daría «no encontrado» o se ignoraría);
 *  - con el centro activo, o uno que no es suyo, se abre como siempre.
 * El cambio lo hace `elegirCentro` al pulsar el botón; aquí se mide qué pinta la página.
 */

const h = vi.hoisted(() => ({
  requireContextoCentro: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
  getAnuncioDetalle: vi.fn(),
  getConversacionDetalle: vi.fn(),
  getAdminFamiliaDetalle: vi.fn(),
  createClient: vi.fn(),
  Confirmar: vi.fn(() => null),
}))

vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  requireContextoCentro: h.requireContextoCentro,
}))
vi.mock('next/navigation', () => ({ notFound: h.notFound, redirect: h.redirect }))
vi.mock('@/features/centros/components/ConfirmarCentroDelAviso', () => ({
  ConfirmarCentroDelAviso: h.Confirmar,
}))
vi.mock('@/features/messaging/queries/get-anuncio-detalle', () => ({
  getAnuncioDetalle: h.getAnuncioDetalle,
}))
vi.mock('@/features/messaging/queries/get-lectores-anuncio', () => ({
  getLectoresAnuncio: vi.fn(async () => []),
}))
vi.mock('@/features/messaging/queries/get-conversacion-detalle', () => ({
  getConversacionDetalle: h.getConversacionDetalle,
}))
vi.mock('@/features/messaging/queries/get-admin-familia-detalle', () => ({
  getAdminFamiliaDetalle: h.getAdminFamiliaDetalle,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/features/messaging/components/AnuncioView', () => ({ AnuncioView: () => null }))
vi.mock('@/features/messaging/components/ConversacionView', () => ({
  ConversacionView: () => null,
}))
vi.mock('@/features/messaging/components/ConversacionAdminFamiliaView', () => ({
  ConversacionAdminFamiliaView: () => null,
}))
vi.mock('@/features/messaging/components/MessagesView', () => ({ MessagesView: () => null }))
vi.mock('@/features/push/components/PushBanner', () => ({ PushBanner: () => null }))
vi.mock('@/features/messaging/queries/get-admin-familia-list', () => ({
  getAdminFamiliaList: vi.fn(async () => []),
}))
vi.mock('@/features/messaging/queries/get-anuncios', () => ({
  getAnunciosDelUsuario: vi.fn(async () => []),
}))
vi.mock('@/features/messaging/queries/get-conversaciones', () => ({
  getConversacionesDelUsuario: vi.fn(async () => []),
}))
vi.mock('@/features/messaging/queries/get-ninos-mensajeria', () => ({
  getNinosMensajeriaParaUsuario: vi.fn(async () => []),
}))
vi.mock('@/features/messaging/queries/get-tutores-para-admin-direccion', () => ({
  getTutoresParaAdminDireccion: vi.fn(async () => []),
}))

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const AJENO = '00000000-0000-4000-8000-0000000000ff'

const contextoEnA: ContextoCentro = {
  centroId: A,
  rol: 'tutor_legal',
  roles: ['tutor_legal'],
  esResponsable: false,
  esSuperusuario: false,
  centros: [
    { centroId: A, rol: 'tutor_legal', roles: ['tutor_legal'], esResponsable: false },
    { centroId: B, rol: 'tutor_legal', roles: ['tutor_legal'], esResponsable: false },
  ],
}

/** El elemento que devuelve la página, si es la confirmación; si no, `null`. */
function confirmacion(el: unknown) {
  const e = el as ReactElement<Record<string, unknown>> | null
  return e && e.type === h.Confirmar ? e.props : null
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireContextoCentro.mockResolvedValue(contextoEnA)
  // Premisa: el usuario tiene los dos centros y está en A.
  expect(contextoEnA.centros.map((c) => c.centroId)).toEqual([A, B])
})

describe('/messages/anuncios/[id]', () => {
  async function abrir(centro?: string) {
    const { default: Page } = await import('../[locale]/messages/anuncios/[id]/page')
    return Page({
      params: Promise.resolve({ locale: 'es', id: 'an-1' }),
      searchParams: Promise.resolve(centro ? { centro } : {}),
    })
  }

  it('notificación de B estando en A → confirmación, sin buscar el anuncio', async () => {
    expect(confirmacion(await abrir(B))).toEqual({
      locale: 'es',
      centroDelAvisoId: B,
      centroActivoId: A,
      returnTo: '/es/messages/anuncios/an-1',
    })
    expect(h.getAnuncioDetalle).not.toHaveBeenCalled()
  })

  it('notificación de A → se abre como siempre, con el centro activo', async () => {
    h.getAnuncioDetalle.mockResolvedValue({ id: 'an-1', es_propio: false })
    expect(confirmacion(await abrir(A))).toBeNull()
    expect(h.getAnuncioDetalle).toHaveBeenCalledWith('an-1', A)
  })

  it('el anuncio de otro centro, sin notificación → no encontrado', async () => {
    h.getAnuncioDetalle.mockResolvedValue(null)
    await expect(abrir()).rejects.toThrow('NOT_FOUND')
    expect(h.getAnuncioDetalle).toHaveBeenCalledWith('an-1', A)
  })

  it('un centro que no es suyo → se ignora: lo de siempre', async () => {
    h.getAnuncioDetalle.mockResolvedValue(null)
    await expect(abrir(AJENO)).rejects.toThrow('NOT_FOUND')
    expect(h.Confirmar).not.toHaveBeenCalled()
  })
})

describe('/messages/conversacion/[id]', () => {
  async function abrir(centro?: string) {
    const { default: Page } = await import('../[locale]/messages/conversacion/[id]/page')
    return Page({
      params: Promise.resolve({ locale: 'es', id: 'c-1' }),
      searchParams: Promise.resolve(centro ? { centro } : {}),
    })
  }

  it('notificación de B estando en A → confirmación, sin buscar la conversación', async () => {
    expect(confirmacion(await abrir(B))).toMatchObject({
      centroDelAvisoId: B,
      centroActivoId: A,
      returnTo: '/es/messages/conversacion/c-1',
    })
    expect(h.createClient).not.toHaveBeenCalled()
  })

  it('notificación de A → busca la conversación como siempre', async () => {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
    }
    h.createClient.mockResolvedValue({ from: () => b })
    await expect(abrir(A)).rejects.toThrow('NOT_FOUND')
    expect(h.createClient).toHaveBeenCalled()
    expect(h.Confirmar).not.toHaveBeenCalled()
  })
})

describe('/messages?nino=', () => {
  it('notificación de B estando en A → confirmación que vuelve al niño', async () => {
    const { default: Page } = await import('../[locale]/messages/page')
    const el = await Page({
      params: Promise.resolve({ locale: 'es' }),
      searchParams: Promise.resolve({ nino: 'n-1', centro: B }),
    })
    expect(confirmacion(el)).toMatchObject({
      centroDelAvisoId: B,
      centroActivoId: A,
      returnTo: '/es/messages?nino=n-1',
    })
  })

  it('notificación de A → la página de siempre', async () => {
    const { default: Page } = await import('../[locale]/messages/page')
    const el = await Page({
      params: Promise.resolve({ locale: 'es' }),
      searchParams: Promise.resolve({ nino: 'n-1', centro: A }),
    })
    expect(confirmacion(el)).toBeNull()
  })
})
