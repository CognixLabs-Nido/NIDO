import { describe, expect, it } from 'vitest'

import {
  crearPublicacionSchema,
  editarPublicacionSchema,
  etiquetarSchema,
  subirFotoSchema,
} from '../publicaciones'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('schemas de fotos (F10-1)', () => {
  describe('crearPublicacionSchema', () => {
    it('acepta aula válida con o sin texto', () => {
      expect(crearPublicacionSchema.safeParse({ aula_id: UUID }).success).toBe(true)
      expect(crearPublicacionSchema.safeParse({ aula_id: UUID, texto: 'Hola' }).success).toBe(true)
    })

    it('rechaza aula no-uuid con clave i18n', () => {
      const r = crearPublicacionSchema.safeParse({ aula_id: 'x' })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.message).toBe('fotos.validation.aula_invalida')
    })

    it('rechaza texto > 2000', () => {
      const r = crearPublicacionSchema.safeParse({ aula_id: UUID, texto: 'a'.repeat(2001) })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.message).toBe('fotos.validation.texto_largo')
    })
  })

  describe('editarPublicacionSchema', () => {
    it('acepta texto nulo (vaciar)', () => {
      expect(editarPublicacionSchema.safeParse({ publicacion_id: UUID, texto: null }).success).toBe(
        true
      )
    })
  })

  describe('etiquetarSchema', () => {
    it('acepta media + niño válidos', () => {
      expect(etiquetarSchema.safeParse({ media_id: UUID, nino_id: UUID }).success).toBe(true)
    })
    it('rechaza niño no-uuid', () => {
      const r = etiquetarSchema.safeParse({ media_id: UUID, nino_id: 'no' })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.message).toBe('fotos.validation.nino_invalido')
    })
  })

  describe('subirFotoSchema', () => {
    it('acepta los MIME permitidos', () => {
      for (const mime of ['image/jpeg', 'image/png', 'image/heic', 'image/heif']) {
        expect(subirFotoSchema.safeParse({ publicacion_id: UUID, mime }).success).toBe(true)
      }
    })
    it('rechaza un MIME no permitido (gif/pdf)', () => {
      const r = subirFotoSchema.safeParse({ publicacion_id: UUID, mime: 'image/gif' })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.message).toBe('fotos.validation.tipo_no_permitido')
    })
  })
})
