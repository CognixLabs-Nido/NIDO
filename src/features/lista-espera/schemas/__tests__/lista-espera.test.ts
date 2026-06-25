import { describe, expect, it } from 'vitest'

import { crearProspectoSchema, reordenarListaEsperaSchema } from '../lista-espera'

const CURSO = '11111111-1111-4111-8111-111111111111'
const OTRO_ID = '22222222-2222-4222-8222-222222222222'

describe('crearProspectoSchema', () => {
  it('normaliza cadenas vacías de campos opcionales a null', () => {
    const r = crearProspectoSchema.parse({
      curso_academico_id: CURSO,
      nombre_nino: '  Niño Demo  ',
      fecha_nacimiento: '',
      telefono_tutor: '',
      email_tutor: '',
      nota: '',
    })
    expect(r.nombre_nino).toBe('Niño Demo') // trim
    expect(r.fecha_nacimiento).toBeNull()
    expect(r.telefono_tutor).toBeNull()
    expect(r.email_tutor).toBeNull()
    expect(r.nota).toBeNull()
  })

  it('acepta fecha y email válidos', () => {
    const r = crearProspectoSchema.parse({
      curso_academico_id: CURSO,
      nombre_nino: 'Niño Demo',
      fecha_nacimiento: '2024-03-15',
      email_tutor: 'tutor@example.com',
    })
    expect(r.fecha_nacimiento).toBe('2024-03-15')
    expect(r.email_tutor).toBe('tutor@example.com')
  })

  it('rechaza nombre vacío', () => {
    const r = crearProspectoSchema.safeParse({ curso_academico_id: CURSO, nombre_nino: '   ' })
    expect(r.success).toBe(false)
  })

  it('rechaza email con formato inválido', () => {
    const r = crearProspectoSchema.safeParse({
      curso_academico_id: CURSO,
      nombre_nino: 'Niño Demo',
      email_tutor: 'no-es-email',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza fecha con formato inválido', () => {
    const r = crearProspectoSchema.safeParse({
      curso_academico_id: CURSO,
      nombre_nino: 'Niño Demo',
      fecha_nacimiento: '15/03/2024',
    })
    expect(r.success).toBe(false)
  })
})

describe('reordenarListaEsperaSchema', () => {
  it('exige al menos un id en el orden', () => {
    expect(
      reordenarListaEsperaSchema.safeParse({ curso_academico_id: CURSO, orden: [] }).success
    ).toBe(false)
  })

  it('acepta una lista de ids válidos', () => {
    const r = reordenarListaEsperaSchema.safeParse({
      curso_academico_id: CURSO,
      orden: [CURSO, OTRO_ID],
    })
    expect(r.success).toBe(true)
  })
})
