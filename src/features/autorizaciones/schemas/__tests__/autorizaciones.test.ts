import { describe, expect, it } from 'vitest'

import {
  crearAutorizacionSalidaSchema,
  editarTextoAutorizacionSchema,
  firmarAutorizacionSchema,
} from '../autorizaciones'

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'
const PNG = 'data:image/png;base64,AAAA'

describe('crearAutorizacionSalidaSchema', () => {
  it('exige evento_id uuid y título', () => {
    expect(
      crearAutorizacionSalidaSchema.safeParse({ evento_id: UUID, titulo: 'Salida' }).success
    ).toBe(true)
    expect(
      crearAutorizacionSalidaSchema.safeParse({ evento_id: 'no-uuid', titulo: 'x' }).success
    ).toBe(false)
    expect(crearAutorizacionSalidaSchema.safeParse({ evento_id: UUID, titulo: '' }).success).toBe(
      false
    )
  })
})

describe('editarTextoAutorizacionSchema — guard del placeholder', () => {
  it('acepta texto definitivo real', () => {
    const r = editarTextoAutorizacionSchema.safeParse({
      autorizacion_id: UUID,
      titulo: 'Salida',
      texto: 'Autorizo la salida.',
      texto_definitivo: true,
    })
    expect(r.success).toBe(true)
  })

  it('rechaza marcar definitivo un texto PENDIENTE', () => {
    const r = editarTextoAutorizacionSchema.safeParse({
      autorizacion_id: UUID,
      titulo: 'Salida',
      texto: 'PENDIENTE',
      texto_definitivo: true,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'autorizaciones.validation.texto_pendiente_no_definitivo'
      )
    }
  })

  it('permite guardar PENDIENTE mientras NO sea definitivo', () => {
    const r = editarTextoAutorizacionSchema.safeParse({
      autorizacion_id: UUID,
      titulo: 'Salida',
      texto: 'PENDIENTE',
      texto_definitivo: false,
    })
    expect(r.success).toBe(true)
  })
})

describe('firmarAutorizacionSchema', () => {
  it('exige firma_imagen como data URL de imagen', () => {
    const base = { autorizacion_id: UUID, nino_id: UUID2, nombre_tecleado: 'Ana Pérez' }
    expect(firmarAutorizacionSchema.safeParse({ ...base, firma_imagen: PNG }).success).toBe(true)
    expect(firmarAutorizacionSchema.safeParse({ ...base, firma_imagen: 'texto' }).success).toBe(
      false
    )
    expect(firmarAutorizacionSchema.safeParse({ ...base, firma_imagen: '' }).success).toBe(false)
  })

  it('exige nombre tecleado no vacío', () => {
    const r = firmarAutorizacionSchema.safeParse({
      autorizacion_id: UUID,
      nino_id: UUID2,
      nombre_tecleado: '',
      firma_imagen: PNG,
    })
    expect(r.success).toBe(false)
  })
})
