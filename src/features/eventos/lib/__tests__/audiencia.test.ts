import { beforeEach, describe, expect, it, vi } from 'vitest'

// La audiencia de eventos reusa el motor de F6-C: solo verificamos el MAPEO
// ámbito→destino (cero duplicación). `@/lib/supabase/admin` se
// mockea porque el módulo lo importa para `tutoresDeNinosConfirmados` (no usado aquí).
const expandirMock = vi.hoisted(() => vi.fn(() => Promise.resolve(['u1'])))
vi.mock('@/features/recordatorios/lib/audiencia', () => ({
  expandirDestinatariosRecordatorio: expandirMock,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { audienciaPushEvento } from '../audiencia'

const AUTOR = 'autor-1'

beforeEach(() => expandirMock.mockClear())

describe('audienciaPushEvento — mapeo ámbito → destino F6-C', () => {
  it('nino → familia_individual', async () => {
    await audienciaPushEvento(
      { ambito: 'nino', centro_id: 'c1', aula_id: null, nino_id: 'n1' },
      AUTOR
    )
    expect(expandirMock).toHaveBeenCalledWith(
      {
        destinatario: 'familia_individual',
        centro_id: 'c1',
        nino_id: 'n1',
        aula_id: null,
        usuario_destinatario_id: null,
      },
      AUTOR
    )
  })

  it('aula → familias_aula', async () => {
    await audienciaPushEvento(
      { ambito: 'aula', centro_id: 'c1', aula_id: 'a1', nino_id: null },
      AUTOR
    )
    expect(expandirMock).toHaveBeenCalledWith(
      {
        destinatario: 'familias_aula',
        centro_id: 'c1',
        nino_id: null,
        aula_id: 'a1',
        usuario_destinatario_id: null,
      },
      AUTOR
    )
  })

  it('centro → familias_centro (sin niño ni aula)', async () => {
    await audienciaPushEvento(
      { ambito: 'centro', centro_id: 'c1', aula_id: null, nino_id: null },
      AUTOR
    )
    expect(expandirMock).toHaveBeenCalledWith(
      {
        destinatario: 'familias_centro',
        centro_id: 'c1',
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: null,
      },
      AUTOR
    )
  })
})
