import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => Promise.resolve({})),
}))

const personas = vi.hoisted(() => ({
  ninosActivosDeAula: vi.fn(),
  ninosDeCentro: vi.fn(),
  tutoresDeNinos: vi.fn(),
  profesDeCentro: vi.fn(),
  profesDeAula: vi.fn(),
}))
vi.mock('@/shared/lib/audiencia-personas', () => personas)

import { resolverInvitadosExplicitos, resolverInvitadosSnapshot } from '../invitados'

const CENTRO = 'centro-1'
const AULA = 'aula-1'
const NINO = 'nino-1'
const ORG = 'org-1'

beforeEach(() => vi.clearAllMocks())

describe('resolverInvitadosSnapshot (expansión por tipo)', () => {
  it('reunion_familia → todos los tutores del niño SIN filtrar el flag', async () => {
    personas.tutoresDeNinos.mockResolvedValue(['t1', 't2'])
    const r = await resolverInvitadosSnapshot({
      tipo: 'reunion_familia',
      centro_id: CENTRO,
      nino_id: NINO,
      aula_id: null,
      invitados: [],
      organizadorId: ORG,
    })
    expect(personas.tutoresDeNinos).toHaveBeenCalledWith(expect.anything(), [NINO], {
      soloConFlag: false,
    })
    expect(r.internos.sort()).toEqual(['t1', 't2'])
    expect(r.externos).toEqual([])
  })

  it('reunion_clase → familias del aula (con flag) + profes del aula', async () => {
    personas.ninosActivosDeAula.mockResolvedValue(['n1', 'n2'])
    personas.tutoresDeNinos.mockResolvedValue(['t1'])
    personas.profesDeAula.mockResolvedValue(['p1'])
    const r = await resolverInvitadosSnapshot({
      tipo: 'reunion_clase',
      centro_id: CENTRO,
      nino_id: null,
      aula_id: AULA,
      invitados: [],
      organizadorId: ORG,
    })
    expect(personas.tutoresDeNinos).toHaveBeenCalledWith(expect.anything(), ['n1', 'n2'], {
      soloConFlag: true,
    })
    expect(personas.profesDeAula).toHaveBeenCalledWith(expect.anything(), AULA)
    expect(r.internos.sort()).toEqual(['p1', 't1'])
  })

  it('reunion_claustro → todas las profes del centro', async () => {
    personas.profesDeCentro.mockResolvedValue(['p1', 'p2'])
    const r = await resolverInvitadosSnapshot({
      tipo: 'reunion_claustro',
      centro_id: CENTRO,
      nino_id: null,
      aula_id: null,
      invitados: [],
      organizadorId: ORG,
    })
    expect(r.internos.sort()).toEqual(['p1', 'p2'])
  })

  it('visita → selección explícita (interno + externo)', async () => {
    const r = await resolverInvitadosSnapshot({
      tipo: 'visita',
      centro_id: CENTRO,
      nino_id: null,
      aula_id: null,
      invitados: [
        { tipo: 'usuario', usuario_id: 'u1' },
        { tipo: 'externo', nombre_externo: 'Comercial Acme' },
      ],
      organizadorId: ORG,
    })
    expect(r.internos).toEqual(['u1'])
    expect(r.externos).toEqual(['Comercial Acme'])
  })

  it('excluye al organizador del set de internos', async () => {
    personas.profesDeCentro.mockResolvedValue(['p1', ORG, 'p2'])
    const r = await resolverInvitadosSnapshot({
      tipo: 'reunion_claustro',
      centro_id: CENTRO,
      nino_id: null,
      aula_id: null,
      invitados: [],
      organizadorId: ORG,
    })
    expect(r.internos).not.toContain(ORG)
    expect(r.internos.sort()).toEqual(['p1', 'p2'])
  })
})

describe('resolverInvitadosExplicitos (editar lista)', () => {
  it('expande grupos con el contexto de la cita y dedup interno', async () => {
    personas.ninosActivosDeAula.mockResolvedValue(['n1'])
    personas.tutoresDeNinos.mockResolvedValue(['t1'])
    personas.profesDeAula.mockResolvedValue(['t1', 'p1']) // t1 duplicado
    const r = await resolverInvitadosExplicitos({
      invitados: [
        { tipo: 'grupo', grupo: 'familias_aula' },
        { tipo: 'grupo', grupo: 'profes_aula' },
        { tipo: 'usuario', usuario_id: 'u9' },
      ],
      aula_id: AULA,
      centro_id: CENTRO,
      organizadorId: ORG,
    })
    expect(r.internos.sort()).toEqual(['p1', 't1', 'u9'])
  })
})
