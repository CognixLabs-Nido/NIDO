import { describe, expect, it } from 'vitest'

import { detectarTutor, guardaTutorUsuarioId, type SenalesTutor } from '../deteccion-tutor'

/** Email tecleado, cuenta operativa y con familia en este centro → el caso "2.º hijo". */
const SEGUNDO_HIJO: SenalesTutor = {
  hayEmail: true,
  cuentaExiste: true,
  tieneRoles: true,
  familiaEnEsteCentro: true,
}

describe('detectarTutor (U-5 · D7)', () => {
  it('sin email: familia nueva, sin consultar nada', () => {
    expect(
      detectarTutor({
        hayEmail: false,
        cuentaExiste: false,
        tieneRoles: false,
        familiaEnEsteCentro: false,
      })
    ).toBe('familia_nueva')
  })

  it('email sin cuenta: familia nueva', () => {
    expect(detectarTutor({ ...SEGUNDO_HIJO, cuentaExiste: false, tieneRoles: false })).toBe(
      'familia_nueva'
    )
  })

  it('cuenta STUB (invitada, sin roles): familia nueva — sigue el flujo de invitación', () => {
    // Mismo criterio que `invitarAlAlta`: `inviteUserByEmail` pre-crea la fila en auth.users,
    // así que "existe" no basta; la señal de cuenta operativa es tener algún rol.
    expect(detectarTutor({ ...SEGUNDO_HIJO, tieneRoles: false })).toBe('familia_nueva')
  })

  it('cuenta REAL con familia en este centro: 2.º hijo de esa familia', () => {
    expect(detectarTutor(SEGUNDO_HIJO)).toBe('familia_existente')
  })

  it('cuenta REAL sin familia en este centro: se etiqueta aparte, no se promete una familia', () => {
    expect(detectarTutor({ ...SEGUNDO_HIJO, familiaEnEsteCentro: false })).toBe(
      'cuenta_sin_familia_aqui'
    )
  })

  it('un email sin cuenta NO se convierte en 2.º hijo por tener familia homónima', () => {
    // Blindaje: la única vía a "existente" pasa por `clasificarCuenta === real`.
    expect(
      detectarTutor({
        hayEmail: true,
        cuentaExiste: false,
        tieneRoles: true,
        familiaEnEsteCentro: true,
      })
    ).toBe('familia_nueva')
  })
})

describe('guardaTutorUsuarioId (D1)', () => {
  it('familia nueva NO guarda tutor_usuario_id', () => {
    expect(guardaTutorUsuarioId('familia_nueva')).toBe(false)
  })

  it('ambos casos de tutor existente SÍ lo guardan (enlace exacto al promover)', () => {
    // Incluido "sin familia aquí": al promover, la RPC crea familia nueva en este centro
    // ligada a ESA cuenta — que es justo lo que ya hace la detección por email de invitar.
    expect(guardaTutorUsuarioId('familia_existente')).toBe(true)
    expect(guardaTutorUsuarioId('cuenta_sin_familia_aqui')).toBe(true)
  })
})
