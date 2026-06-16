import { describe, expect, it } from 'vitest'

import { clasificarCuenta, debeMostrarB8 } from '../clasificar-cuenta'

/**
 * Fix Fase 1: la page y `acceptInvitation` deben distinguir el STUB de
 * `inviteUserByEmail` (auth.users sin roles → FORMULARIO) de una cuenta REAL
 * (con roles → B8). La señal es la presencia de `roles_usuario`.
 */
describe('clasificarCuenta', () => {
  it('sin fila en auth.users → nueva (ve formulario)', () => {
    expect(clasificarCuenta(false, false)).toBe('nueva')
    // `tieneRoles` es irrelevante si no hay usuario.
    expect(clasificarCuenta(false, true)).toBe('nueva')
  })

  it('fila en auth.users SIN roles → stub (ve formulario, NO B8)', () => {
    expect(clasificarCuenta(true, false)).toBe('stub')
  })

  it('fila en auth.users CON roles → real (B8)', () => {
    expect(clasificarCuenta(true, true)).toBe('real')
  })
})

describe('debeMostrarB8', () => {
  it('solo la cuenta real va a B8', () => {
    expect(debeMostrarB8(true, true)).toBe(true) // real
    expect(debeMostrarB8(true, false)).toBe(false) // stub → formulario
    expect(debeMostrarB8(false, false)).toBe(false) // nueva → formulario
  })

  it('edge 2.º niño: usuario real (ya con roles) invitado a otro niño → B8', () => {
    // El email tiene cuenta operativa (roles) → debeMostrarB8=true → /profile/invitations
    // → acceptPendingInvitation (camino Pieza 1). El fix NO lo desvía al formulario.
    expect(debeMostrarB8(true, true)).toBe(true)
  })
})
