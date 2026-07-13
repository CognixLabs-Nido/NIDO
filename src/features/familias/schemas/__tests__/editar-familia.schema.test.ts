import { describe, expect, it } from 'vitest'

import { editarEtiquetaFamiliaSchema, editarPerfilTutorSchema } from '../editar-familia'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('editarEtiquetaFamiliaSchema', () => {
  it('acepta una etiqueta 1–200', () => {
    expect(
      editarEtiquetaFamiliaSchema.safeParse({ familia_id: UUID, etiqueta: 'García' }).success
    ).toBe(true)
  })

  it('rechaza etiqueta vacía', () => {
    const r = editarEtiquetaFamiliaSchema.safeParse({ familia_id: UUID, etiqueta: '   ' })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('admin.familias.validation.etiqueta_requerida')
  })

  it('rechaza etiqueta > 200', () => {
    const r = editarEtiquetaFamiliaSchema.safeParse({ familia_id: UUID, etiqueta: 'x'.repeat(201) })
    expect(r.success).toBe(false)
  })

  it('rechaza familia_id no-uuid', () => {
    expect(
      editarEtiquetaFamiliaSchema.safeParse({ familia_id: 'no', etiqueta: 'ok' }).success
    ).toBe(false)
  })
})

describe('editarPerfilTutorSchema', () => {
  const base = {
    tutor_id: UUID,
    nombre_completo: 'Ana Pérez',
    email: 'ana@nido.test',
    direccion_calle: 'Calle Mayor',
    direccion_numero: '3',
    direccion_cp: '46001',
    direccion_ciudad: 'València',
  }

  it('acepta un perfil completo', () => {
    expect(editarPerfilTutorSchema.safeParse(base).success).toBe(true)
  })

  it('acepta dirección y email nulos (campos opcionales)', () => {
    const r = editarPerfilTutorSchema.safeParse({
      tutor_id: UUID,
      nombre_completo: 'Ana',
      email: null,
      direccion_calle: null,
      direccion_numero: null,
      direccion_cp: null,
      direccion_ciudad: null,
    })
    expect(r.success).toBe(true)
  })

  it('acepta que se omitan los campos de dirección (optional)', () => {
    expect(
      editarPerfilTutorSchema.safeParse({ tutor_id: UUID, nombre_completo: 'Ana', email: null })
        .success
    ).toBe(true)
  })

  it('rechaza email con formato inválido', () => {
    const r = editarPerfilTutorSchema.safeParse({ ...base, email: 'no-es-email' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('admin.familias.validation.email')
  })

  it('rechaza nombre vacío (pero acepta null)', () => {
    expect(editarPerfilTutorSchema.safeParse({ ...base, nombre_completo: '' }).success).toBe(false)
    expect(editarPerfilTutorSchema.safeParse({ ...base, nombre_completo: null }).success).toBe(true)
  })
})
