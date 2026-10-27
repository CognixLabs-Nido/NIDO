import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

/**
 * El séptimo envío de push (alta de un hermano por un tutor que ya tiene cuenta) ya iba en el
 * idioma del DESTINATARIO: lee su `idioma_preferido` y traduce el título, el texto y el enlace a
 * él. No pasa por `enviarPushPorIdioma` (tiene un solo destinatario). Este test lo fija, para
 * que no se rompa: el idioma de la página de quien da el alta (`params.locale`) no cuenta.
 */

const h = vi.hoisted(() => ({
  enviar: vi.fn(async () => ({ enviados: 1, expirados: 0, errores: 0, total: 1 })),
  idiomaTutor: 'va' as string | null,
}))

vi.mock('@/features/push/lib/enviar-push', () => ({ enviarPushANotificarUsuarios: h.enviar }))
vi.mock('../vinculo-previo-tutor', () => ({
  buscarVinculoPrevio: async () => ({ parentesco: 'madre', descripcion_parentesco: null }),
}))
// Traducciones reales: un mock que ignorase los parámetros no vería si el nombre entra.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const mensajes: Record<string, Record<string, unknown>> = {
    es: (await import('@/../messages/es.json')).default,
    va: (await import('@/../messages/va.json')).default,
  }
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: mensajes[locale]!, namespace } as never),
  }
})

const { vincularHijoATutorExistente } = await import('../vincular-hijo-tutor-existente')

const TUTOR = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'

/** Service client falso: perfil del tutor en el centro y su idioma. */
function service(): SupabaseClient<Database> {
  return {
    from(tabla: string) {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'limit']) b[m] = () => b
      b.maybeSingle = async () => ({
        data:
          tabla === 'familia_tutores'
            ? { nombre_completo: 'Tutora Existente', email: 'tutora@example.test' }
            : tabla === 'usuarios'
              ? h.idiomaTutor === null
                ? null
                : { idioma_preferido: h.idiomaTutor }
              : null,
        error: null,
      })
      return b
    },
  } as unknown as SupabaseClient<Database>
}

const autenticado = {
  rpc: async () => ({
    data: { resultado: 'nino_anadido', familia_id: 'f-1', nino_id: NINO, colision_info: null },
    error: null,
  }),
} as unknown as SupabaseClient<Database>

const params = {
  tutorUsuarioId: TUTOR,
  centroId: 'centro-1',
  aulaId: 'aula-1',
  nombreNino: 'Hermano Nuevo',
  apellidosNino: 'Demo',
  fechaNacimiento: '2025-03-01',
  // La página de quien da el alta, en castellano: NO es el idioma del aviso.
  locale: 'es',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.idiomaTutor = 'va'
})

describe('alta de un hermano: el push va en el idioma del tutor', () => {
  it('título, texto y enlace en el idioma del tutor, no en el de la página', async () => {
    const r = await vincularHijoATutorExistente(service(), autenticado, params)
    expect(r).toEqual({ success: true, data: { ninoId: NINO } })
    expect(h.enviar).toHaveBeenCalledWith(
      [TUTOR],
      expect.objectContaining({
        titulo: 'Nou fill en la teua família',
        cuerpo: 'Tens una alta pendent de completar',
        url: `/va/alta/${NINO}`,
      })
    )
  })

  it('sin perfil legible, cae al idioma de la página', async () => {
    h.idiomaTutor = null
    await vincularHijoATutorExistente(service(), autenticado, params)
    expect(h.enviar).toHaveBeenCalledWith(
      [TUTOR],
      expect.objectContaining({ url: `/es/alta/${NINO}` })
    )
  })

  // F11-B, punto 8: la notificación se ve en la pantalla bloqueada; el nombre del niño no va.
  it('la push no lleva el nombre del niño', async () => {
    await vincularHijoATutorExistente(service(), autenticado, params)
    // Premisa: la push salió.
    expect(h.enviar).toHaveBeenCalledTimes(1)
    const payload = (h.enviar.mock.calls[0] as unknown[])[1]
    expect(JSON.stringify(payload)).not.toContain(params.nombreNino)
    expect(JSON.stringify(payload)).not.toContain(params.apellidosNino)
  })
})
