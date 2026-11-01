import { describe, expect, it } from 'vitest'

import { rolALaFecha, type Historia, type PreguntaRol } from '../roles-a-la-fecha'

/**
 * El rol a la fecha (R4, decisión de Jose del 2026-11-01): el que tenía ESE día, de su vínculo, de
 * su rol en el centro o de su asignación al aula del niño; «soporte de la plataforma» para el
 * superusuario; y «no consta» cuando no se puede reconstruir, nunca una etiqueta inventada.
 */

const H: Historia = {
  superusuarios: new Set(['super']),
  roles: [
    {
      usuario_id: 'dir',
      centro_id: 'k1',
      rol: 'directora',
      desde: '2026-01-01T00:00:00.000Z',
      hasta: null,
    },
    // Profe del 1 de septiembre al 1 de octubre (salió del centro).
    {
      usuario_id: 'pro',
      centro_id: 'k1',
      rol: 'profe',
      desde: '2026-09-01T00:00:00.000Z',
      hasta: '2026-10-01T00:00:00.000Z',
    },
    {
      usuario_id: 'pro2',
      centro_id: 'k1',
      rol: 'profe',
      desde: '2026-09-01T00:00:00.000Z',
      hasta: null,
    },
    {
      usuario_id: 'tut',
      centro_id: 'k1',
      rol: 'tutor_legal',
      desde: '2026-09-01T00:00:00.000Z',
      hasta: null,
    },
    // Superusuario que además es admin de otro centro.
    {
      usuario_id: 'super',
      centro_id: 'k2',
      rol: 'admin',
      desde: '2026-01-01T00:00:00.000Z',
      hasta: null,
    },
  ],
  vinculos: [
    {
      usuario_id: 'tut',
      nino_id: 'n1',
      tipo_vinculo: 'tutor_legal_secundario',
      desde: '2026-09-01T00:00:00.000Z',
      hasta: null,
    },
  ],
  matriculas: [{ nino_id: 'n1', aula_id: 'a1', desde: '2026-09-01', hasta: null }],
  aulas: [
    {
      profe_id: 'pro',
      aula_id: 'a1',
      tipo_personal_aula: 'profesora',
      desde: '2026-09-01',
      hasta: '2026-09-30',
    },
    // pro2 está en otra aula.
    {
      profe_id: 'pro2',
      aula_id: 'a2',
      tipo_personal_aula: 'coordinadora',
      desde: '2026-09-01',
      hasta: null,
    },
  ],
}

function rol(usuarioId: unknown, fecha: unknown, extra: Partial<PreguntaRol> = {}): string {
  return rolALaFecha(H, {
    usuarioId,
    fecha,
    centroId: 'k1',
    ninoId: 'n1',
    sujetoId: null,
    ...extra,
  })
}

describe('el rol a la fecha', () => {
  it('premisa: con la historia de delante, cada fuente da su rol', () => {
    expect(rol('dir', '2026-10-15T10:00:00Z')).toBe('Dirección')
    expect(rol('tut', '2026-10-15T10:00:00Z')).toBe('tutor/a legal secundario/a')
  })

  it('la profe en el aula del niño ese día sale con su tipo; fuera de esas fechas, no', () => {
    expect(rol('pro', '2026-09-15T10:00:00Z')).toBe('profesora del aula')
    // Su asignación acabó el 30 de septiembre; el rol, el 1 de octubre.
    expect(rol('pro', '2026-09-30T20:00:00Z')).toBe('profesora del aula') // 22:00 en Madrid, día 30
    // Ya es 1 de octubre en Madrid: sin el aula, pero el rol sigue vivo hasta las 00:00 UTC.
    expect(rol('pro', '2026-09-30T22:30:00Z')).toBe('personal docente del centro')
    expect(rol('pro', '2026-10-01T00:00:00Z')).toBe('no consta')
    expect(rol('pro', '2026-10-15T10:00:00Z')).toBe('no consta')
  })

  it('la profe del centro sin el aula del niño es personal docente del centro', () => {
    expect(rol('pro2', '2026-10-15T10:00:00Z')).toBe('personal docente del centro')
    expect(rol('pro2', '2026-10-15T10:00:00Z', { ninoId: null })).toBe(
      'personal docente del centro'
    )
  })

  it('antes de tener su rol no consta, aunque lo tenga hoy', () => {
    expect(rol('dir', '2025-12-31T10:00:00Z')).toBe('no consta')
    expect(rol('tut', '2026-08-31T10:00:00Z')).toBe('no consta')
  })

  it('un tutor con rol y sin vínculo con este niño es familia del centro', () => {
    expect(rol('tut', '2026-10-15T10:00:00Z', { ninoId: 'otro' })).toBe('familia del centro')
  })

  it('el superusuario es el soporte de la plataforma, aunque sea admin de otro centro', () => {
    expect(rol('super', '2026-10-15T10:00:00Z')).toBe('soporte de la plataforma')
  })

  it('la propia persona interesada es «tú»', () => {
    expect(rol('dir', '2026-10-15T10:00:00Z', { sujetoId: 'dir' })).toBe('tú')
  })

  it('sin persona, sin fecha o sin nada que conste: «no consta»', () => {
    expect(rol(null, '2026-10-15T10:00:00Z')).toBe('no consta')
    expect(rol('dir', null)).toBe('no consta')
    expect(rol('desconocida', '2026-10-15T10:00:00Z')).toBe('no consta')
    expect(rol('dir', '2026-10-15T10:00:00Z', { centroId: 'otro' })).toBe('no consta')
  })
})
