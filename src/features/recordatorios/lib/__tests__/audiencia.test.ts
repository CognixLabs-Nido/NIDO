import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fixtures por tabla que el fake service client devuelve. Cada test los reescribe.
let fixtures: Record<string, unknown[]>

vi.mock('@/features/auth/actions/_service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      // Builder encadenable y "thenable": cualquier .select/.eq/.in/.is devuelve
      // this, y al await-earlo resuelve { data } con la fixture de esa tabla.
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.in = chain
      builder.is = chain
      builder.then = (resolve: (v: { data: unknown[] }) => unknown) =>
        resolve({ data: fixtures[table] ?? [] })
      return builder
    },
  })),
}))

import { expandirDestinatariosRecordatorio } from '../audiencia'

const CENTRO = 'centro-1'
const AUTOR = 'autor-1'

beforeEach(() => {
  fixtures = {}
})

describe('expandirDestinatariosRecordatorio — 6 destinos (F6-C, D5)', () => {
  it('personal → [] (no consulta nada)', async () => {
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'personal',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: AUTOR,
      },
      AUTOR
    )
    expect(r).toEqual([])
  })

  it('profe_individual → [usuario_destinatario_id]; excluye si es el autor', async () => {
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'profe_individual',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: 'profe-9',
      },
      AUTOR
    )
    expect(r).toEqual(['profe-9'])

    const propio = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'profe_individual',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: AUTOR,
      },
      AUTOR
    )
    expect(propio).toEqual([])
  })

  it('profes_centro → usuarios con rol profe del centro, excluyendo al autor', async () => {
    fixtures.roles_usuario = [
      { usuario_id: 'profe-a' },
      { usuario_id: 'profe-b' },
      { usuario_id: AUTOR },
    ]
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'profes_centro',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: null,
      },
      AUTOR
    )
    expect(r.sort()).toEqual(['profe-a', 'profe-b'])
  })

  it('familia_individual → solo tutores con puede_recibir_mensajes=true', async () => {
    fixtures.vinculos_familiares = [
      { usuario_id: 'tutor-con-flag', permisos: { puede_recibir_mensajes: true } },
      { usuario_id: 'tutor-sin-flag', permisos: { puede_recibir_mensajes: false } },
      { usuario_id: 'autorizado-sin-permisos', permisos: {} },
    ]
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familia_individual',
        centro_id: CENTRO,
        nino_id: 'nino-1',
        aula_id: null,
        usuario_destinatario_id: null,
      },
      AUTOR
    )
    expect(r).toEqual(['tutor-con-flag'])
  })

  it('familias_aula → tutores con flag de los niños activos del aula (dedup)', async () => {
    fixtures.matriculas = [{ nino_id: 'nino-1' }, { nino_id: 'nino-2' }]
    fixtures.vinculos_familiares = [
      { usuario_id: 'tutor-1', permisos: { puede_recibir_mensajes: true } },
      { usuario_id: 'tutor-1', permisos: { puede_recibir_mensajes: true } }, // dup (hermanos)
      { usuario_id: 'tutor-2', permisos: { puede_recibir_mensajes: true } },
      { usuario_id: 'tutor-mudo', permisos: { puede_recibir_mensajes: false } },
    ]
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familias_aula',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: 'aula-1',
        usuario_destinatario_id: null,
      },
      AUTOR
    )
    expect(r.sort()).toEqual(['tutor-1', 'tutor-2'])
  })

  it('familias_aula sin niños matriculados → []', async () => {
    fixtures.matriculas = []
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familias_aula',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: 'aula-vacia',
        usuario_destinatario_id: null,
      },
      AUTOR
    )
    expect(r).toEqual([])
  })

  it('familias_centro → tutores con flag de todos los niños del centro', async () => {
    fixtures.ninos = [{ id: 'nino-1' }, { id: 'nino-2' }]
    fixtures.vinculos_familiares = [
      { usuario_id: 'tutor-1', permisos: { puede_recibir_mensajes: true } },
      { usuario_id: 'tutor-2', permisos: { puede_recibir_mensajes: true } },
    ]
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familias_centro',
        centro_id: CENTRO,
        nino_id: null,
        aula_id: null,
        usuario_destinatario_id: null,
      },
      AUTOR
    )
    expect(r.sort()).toEqual(['tutor-1', 'tutor-2'])
  })

  // --- REGRESIÓN PUSH (obligatoria, spec F6-C-1) -----------------------------
  // El bug aparcado de F6-B: el resolver devolvía [] para "familia concreta",
  // así que no se enviaba push sin error. Aquí garantizamos que admin →
  // familia_individual del niño incluye al tutor con flag. NO debe volver vacío.
  it('REGRESIÓN: admin → familia_individual incluye al tutor del niño con flag', async () => {
    const NINO = '7ce87b08-ef64-42e8-883e-56aa807ebd82'
    const TUTOR = '930d0b6b-35ad-4dab-8bbb-568076c01758'
    fixtures.vinculos_familiares = [
      { usuario_id: TUTOR, permisos: { puede_recibir_mensajes: true } },
    ]
    const r = await expandirDestinatariosRecordatorio(
      {
        destinatario: 'familia_individual',
        centro_id: CENTRO,
        nino_id: NINO,
        aula_id: null,
        usuario_destinatario_id: null,
      },
      'admin-autor'
    )
    expect(r).toContain(TUTOR)
    expect(r.length).toBeGreaterThan(0)
  })
})
