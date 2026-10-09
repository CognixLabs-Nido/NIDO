import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

import { invitarTutor2AlValidar } from '../invitar-tutor-2'

/**
 * Alta del 2.º hijo — `invitarTutor2AlValidar` solo invita al tutor 2 SIN cuenta en la
 * familia. Con cuenta lo vincula la RPC (invitarle fallaba con `email_exists`); con una
 * invitación abierta de otro hijo no se reinvita (al aceptarla queda vinculado a todos).
 */

const NINO = '22222222-2222-4222-8222-222222222222'
const CENTRO = '33333333-3333-4333-8333-333333333333'

const sendInvitation = vi.fn()
const leerTutoresDeNino = vi.fn()

vi.mock('@/features/auth/actions/send-invitation', () => ({
  sendInvitation: (...args: unknown[]) => sendInvitation(...args),
}))
vi.mock('@/features/alta/lib/tutores-familia', () => ({
  leerTutoresDeNino: (...args: unknown[]) => leerTutoresDeNino(...args),
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }))

/** Cliente falso: cada tabla responde lo configurado; `consultadas` registra las tablas leídas. */
function makeFake(respuestas: Record<string, unknown>) {
  const consultadas: string[] = []
  function builder(table: string) {
    consultadas.push(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    for (const m of ['select', 'eq', 'is', 'gt', 'limit', 'maybeSingle']) b[m] = () => b
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: respuestas[table] ?? null, error: null })
    return b
  }
  const fake = { from: (t: string) => builder(t) } as unknown as SupabaseClient<Database>
  return { fake, consultadas }
}

function tutores(tutor2: { email: string | null; usuario_id: string | null } | null) {
  const lista = [
    { tipo_vinculo: 'tutor_legal_principal', email: 't1@nido.test', usuario_id: 'u-t1' },
  ]
  if (tutor2) lista.push({ tipo_vinculo: 'tutor_legal_secundario', ...tutor2 } as never)
  return { tutores: lista }
}

beforeEach(() => {
  sendInvitation.mockReset()
  sendInvitation.mockResolvedValue({ success: true, data: { invitationId: 'inv-1' } })
  leerTutoresDeNino.mockReset()
})

describe('invitarTutor2AlValidar', () => {
  it('tutor 2 SIN cuenta, sin invitación abierta ni vínculo → lo invita como secundario', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores({ email: 't2@nido.test', usuario_id: null }))
    const { fake } = makeFake({ ninos: { centro_id: CENTRO } })

    await invitarTutor2AlValidar(fake, NINO)

    expect(sendInvitation).toHaveBeenCalledWith({
      email: 't2@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: CENTRO,
      ninoId: NINO,
      tipoVinculo: 'tutor_legal_secundario',
      idioma: 'es',
    })
  })

  it('el correo del tutor 2 sale en el idioma del tutor principal', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores({ email: 't2@nido.test', usuario_id: null }))
    const { fake } = makeFake({
      ninos: { centro_id: CENTRO },
      usuarios: { idioma_preferido: 'va' },
    })

    await invitarTutor2AlValidar(fake, NINO)

    expect(sendInvitation).toHaveBeenCalledWith(expect.objectContaining({ idioma: 'va' }))
  })

  it('tutor 2 CON cuenta en la familia → no invita (lo vincula la RPC)', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores({ email: 't2@nido.test', usuario_id: 'u-t2' }))
    const { fake, consultadas } = makeFake({ ninos: { centro_id: CENTRO } })

    await invitarTutor2AlValidar(fake, NINO)

    expect(sendInvitation).not.toHaveBeenCalled()
    expect(consultadas).not.toContain('invitaciones')
  })

  it('tutor 2 sin cuenta pero YA vinculado a este niño → no invita', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores({ email: 't2@nido.test', usuario_id: null }))
    const { fake } = makeFake({ ninos: { centro_id: CENTRO }, vinculos_familiares: { id: 'v-1' } })

    await invitarTutor2AlValidar(fake, NINO)

    expect(sendInvitation).not.toHaveBeenCalled()
  })

  it('tutor 2 sin cuenta con una invitación abierta (de otro hijo) → no reinvita', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores({ email: 't2@nido.test', usuario_id: null }))
    const { fake, consultadas } = makeFake({
      ninos: { centro_id: CENTRO },
      invitaciones: { id: 'inv-abierta' },
    })

    await invitarTutor2AlValidar(fake, NINO)

    expect(consultadas).toContain('invitaciones')
    expect(sendInvitation).not.toHaveBeenCalled()
  })

  it('sin tutor 2 (o sin email) → no invita', async () => {
    leerTutoresDeNino.mockResolvedValue(tutores(null))
    const { fake } = makeFake({ ninos: { centro_id: CENTRO } })

    await invitarTutor2AlValidar(fake, NINO)

    expect(sendInvitation).not.toHaveBeenCalled()
  })
})
