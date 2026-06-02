import { describe, expect, it } from 'vitest'

import {
  agregarInvitadosSchema,
  crearCitaSchema,
  editarCitaSchema,
  responderInvitacionSchema,
  setPreferenciaVistaAgendaSchema,
} from '../citas'

const AULA = '55555555-5555-4555-8555-555555555555'
const NINO = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CITA = '44444444-4444-4444-8444-444444444444'
const INVITADO = '66666666-6666-4666-8666-666666666666'

const base = {
  titulo: 'Reunión de seguimiento',
  fecha: '2026-09-10',
  hora_inicio: '17:00',
}

function issues(r: ReturnType<typeof crearCitaSchema.safeParse>): string[] {
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('crearCitaSchema — coherencia tipo ↔ referencia', () => {
  it('acepta reunion_familia con nino_id', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_familia', nino_id: NINO, ...base })
    expect(r.success).toBe(true)
  })

  it('rechaza reunion_familia sin nino_id', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_familia', ...base })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.nino_requerido')
  })

  it('acepta reunion_clase con aula_id', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_clase', aula_id: AULA, ...base })
    expect(r.success).toBe(true)
  })

  it('rechaza reunion_clase con nino_id (coherencia)', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'reunion_clase',
      aula_id: AULA,
      nino_id: NINO,
      ...base,
    })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.nino_no_permitido')
  })

  it('acepta reunion_claustro sin referencias', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_claustro', ...base })
    expect(r.success).toBe(true)
  })

  it('rechaza visita con aula_id', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'visita',
      aula_id: AULA,
      ...base,
      invitados: [{ tipo: 'externo', nombre_externo: 'Proveedor X' }],
    })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.aula_no_permitida')
  })
})

describe('crearCitaSchema — horas e invitados', () => {
  it('rechaza hora_fin <= hora_inicio', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_claustro', ...base, hora_fin: '16:00' })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.hora_fin_invalida')
  })

  it('acepta hora_fin > hora_inicio', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_claustro', ...base, hora_fin: '18:00' })
    expect(r.success).toBe(true)
  })

  it('exige al menos un invitado en visita', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'visita', ...base })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.sin_invitados')
  })

  it('acepta visita con invitado externo e interno', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'visita',
      ...base,
      invitados: [
        { tipo: 'externo', nombre_externo: 'Comercial Acme' },
        { tipo: 'usuario', usuario_id: USER },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza invitado externo en una reunión (solo visita)', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'reunion_clase',
      aula_id: AULA,
      ...base,
      invitados: [{ tipo: 'externo', nombre_externo: 'Alguien' }],
    })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.externo_solo_visita')
  })

  it('acepta grupos familias_aula + profes_aula en reunion_clase', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'reunion_clase',
      aula_id: AULA,
      ...base,
      invitados: [
        { tipo: 'grupo', grupo: 'familias_aula' },
        { tipo: 'grupo', grupo: 'profes_aula' },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza grupo profes_centro fuera de reunion_claustro', () => {
    const r = crearCitaSchema.safeParse({
      tipo: 'reunion_clase',
      aula_id: AULA,
      ...base,
      invitados: [{ tipo: 'grupo', grupo: 'profes_centro' }],
    })
    expect(r.success).toBe(false)
    expect(issues(r)).toContain('citas.validation.grupo_no_permitido')
  })

  it('rechaza título vacío', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_claustro', ...base, titulo: '   ' })
    expect(r.success).toBe(false)
  })

  it('rechaza hora con formato inválido', () => {
    const r = crearCitaSchema.safeParse({ tipo: 'reunion_claustro', ...base, hora_inicio: '7:00' })
    expect(r.success).toBe(false)
  })
})

describe('editarCitaSchema', () => {
  it('acepta edición de contenido y horas', () => {
    const r = editarCitaSchema.safeParse({ cita_id: CITA, ...base, hora_fin: '18:30' })
    expect(r.success).toBe(true)
  })

  it('rechaza hora_fin <= hora_inicio', () => {
    const r = editarCitaSchema.safeParse({ cita_id: CITA, ...base, hora_fin: '16:00' })
    expect(r.success).toBe(false)
  })
})

describe('responderInvitacionSchema', () => {
  it('acepta aceptado/rechazado', () => {
    expect(responderInvitacionSchema.safeParse({ cita_id: CITA, estado: 'aceptado' }).success).toBe(
      true
    )
    expect(
      responderInvitacionSchema.safeParse({ cita_id: CITA, estado: 'rechazado' }).success
    ).toBe(true)
  })

  it('rechaza estado pendiente (no es una respuesta)', () => {
    expect(
      responderInvitacionSchema.safeParse({ cita_id: CITA, estado: 'pendiente' }).success
    ).toBe(false)
  })
})

describe('agregarInvitadosSchema', () => {
  it('exige al menos un invitado', () => {
    expect(agregarInvitadosSchema.safeParse({ cita_id: CITA, invitados: [] }).success).toBe(false)
  })

  it('acepta una lista de invitados', () => {
    const r = agregarInvitadosSchema.safeParse({
      cita_id: CITA,
      invitados: [{ tipo: 'usuario', usuario_id: USER }],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza un usuario_id que no es uuid', () => {
    const r = agregarInvitadosSchema.safeParse({
      cita_id: INVITADO,
      invitados: [{ tipo: 'usuario', usuario_id: 'no-uuid' }],
    })
    expect(r.success).toBe(false)
  })
})

describe('setPreferenciaVistaAgendaSchema', () => {
  it('acepta dia/semana/mes', () => {
    for (const vista of ['dia', 'semana', 'mes'] as const) {
      expect(setPreferenciaVistaAgendaSchema.safeParse({ vista }).success).toBe(true)
    }
  })

  it('rechaza una vista desconocida', () => {
    expect(setPreferenciaVistaAgendaSchema.safeParse({ vista: 'anual' }).success).toBe(false)
  })
})
