import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushPayload } from '@/features/push/types'

/**
 * Las tres notificaciones del calendario (crear, editar, cancelar) van en el idioma de QUIEN LAS
 * RECIBE: el texto y el enlace `/{idioma}/calendario`. Antes iban en el del autor, y la de
 * cancelar decía «Cancelado:» en castellano para todos.
 */

const h = vi.hoisted(() => ({
  enviar: vi.fn(async (ids: string[], _payload: PushPayload) => ({
    enviados: ids.length,
    expirados: 0,
    errores: 0,
    total: ids.length,
  })),
}))

vi.mock('@/features/push/lib/enviar-push', () => ({ enviarPushANotificarUsuarios: h.enviar }))
vi.mock('@/features/push/lib/audiencia', () => ({
  getAutorPushInfo: async () => ({ nombre: 'Directora' }),
  idiomasDeUsuarios: async () =>
    new Map([
      ['tutor-va', 'va'],
      ['tutor-en', 'en'],
    ]),
}))
vi.mock('../audiencia', () => ({
  audienciaPushEvento: async () => ['tutor-va', 'tutor-en'],
  tutoresDeNinosConfirmados: async () => ['tutor-va', 'tutor-en'],
}))
// Dice en qué idioma se pidió cada texto.
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (k: string, p?: Record<string, string>) =>
      `${locale}:${namespace}.${k}:${p?.titulo ?? ''}`,
}))

const { notificarEvento, notificarEdicionEvento, notificarCancelacion } =
  await import('../notificar')

const evento = {
  id: 'ev-1',
  ambito: 'centro' as const,
  centro_id: 'c-1',
  aula_id: null,
  nino_id: null,
  titulo: 'Fiesta de otoño',
}

/** La notificación que recibió el grupo de `primero` (falla si ese grupo no recibió nada). */
function envioDe(primero: string): PushPayload {
  const llamada = h.enviar.mock.calls.find(([ids]) => ids[0] === primero)
  if (!llamada) throw new Error(`sin envío para ${primero}`)
  return llamada[1]
}

beforeEach(() => vi.clearAllMocks())

describe('notificaciones del calendario, en el idioma de quien las recibe', () => {
  it('crear: un envío por idioma, con su enlace', async () => {
    await notificarEvento('autor-1', evento)
    expect(h.enviar).toHaveBeenCalledTimes(2)
    expect(envioDe('tutor-va')).toMatchObject({
      titulo: 'Directora',
      cuerpo: 'Fiesta de otoño',
      url: '/va/calendario',
    })
    expect(envioDe('tutor-en').url).toBe('/en/calendario')
  })

  it('editar: el texto traducido al idioma de cada uno', async () => {
    await notificarEdicionEvento('autor-1', evento)
    expect(envioDe('tutor-va').cuerpo).toBe('va:eventos.push.actualizado:Fiesta de otoño')
    expect(envioDe('tutor-en').cuerpo).toBe('en:eventos.push.actualizado:Fiesta de otoño')
    expect(envioDe('tutor-en').url).toBe('/en/calendario')
  })

  it('cancelar: el texto traducido (ya no un «Cancelado:» fijo en castellano)', async () => {
    await notificarCancelacion('autor-1', 'ev-1', 'Fiesta de otoño')
    expect(envioDe('tutor-va').cuerpo).toBe('va:eventos.push.cancelado:Fiesta de otoño')
    expect(envioDe('tutor-en').cuerpo).toBe('en:eventos.push.cancelado:Fiesta de otoño')
    expect(envioDe('tutor-va').url).toBe('/va/calendario')
  })
})
