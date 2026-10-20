import { describe, expect, it } from 'vitest'

import { detectarTutor, guardaTutorUsuarioId } from '../deteccion-tutor'

describe('detectarTutor (U-5 · D7, PR 1 de la Fase 4)', () => {
  it('sin email: familia nueva, sin consultar nada', () => {
    expect(detectarTutor({ hayEmail: false, familiaEnEsteCentro: false })).toBe('familia_nueva')
  })

  it('con familia en este centro: 2.º hijo de esa familia', () => {
    expect(detectarTutor({ hayEmail: true, familiaEnEsteCentro: true })).toBe('familia_existente')
  })

  it('sin familia en este centro: familia nueva, tenga o no cuenta en otro sitio (D4)', () => {
    // Quien llama ni siquiera le pasa si la cuenta existe: no hay forma de que la pantalla lo diga.
    expect(detectarTutor({ hayEmail: true, familiaEnEsteCentro: false })).toBe('familia_nueva')
  })
})

describe('guardaTutorUsuarioId (D1)', () => {
  it('familia nueva NO guarda tutor_usuario_id', () => {
    expect(guardaTutorUsuarioId('familia_nueva')).toBe(false)
  })

  it('el 2.º hijo de una familia de este centro SÍ lo guarda (enlace exacto al promover)', () => {
    expect(guardaTutorUsuarioId('familia_existente')).toBe(true)
  })
})
