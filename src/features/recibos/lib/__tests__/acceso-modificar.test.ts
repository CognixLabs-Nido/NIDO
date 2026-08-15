import { describe, expect, it } from 'vitest'

import { accesoModificar } from '../acceso-modificar'

/**
 * R-5 — la decisión de si un recibo confirmado se puede reabrir. Es la misma función que
 * pinta el botón y la que la action usa para rechazar, así que aquí se fija el contrato
 * completo: qué se permite, qué no, y con qué motivo (el motivo se le enseña a la
 * directora, no es un detalle interno).
 */
describe('accesoModificar (R-5)', () => {
  it('permite modificar un confirmado que no está en ninguna remesa', () => {
    expect(accesoModificar('pendiente_procesar', false)).toEqual({ permitido: true })
  })

  it('bloquea por REMESA: la salvaguarda de Jose', () => {
    expect(accesoModificar('pendiente_procesar', true)).toEqual({
      permitido: false,
      motivo: 'en_remesa',
    })
  })

  it('bloquea un cobro ya avanzado aunque no haya remesa (cobro fuera de SEPA)', () => {
    expect(accesoModificar('cobrado_manual', false)).toEqual({
      permitido: false,
      motivo: 'cobro_avanzado',
    })
  })

  it.each(['enviado_banco', 'devuelto', 'cobrado_manual'] as const)(
    'con remesa, %s se explica por la remesa: es lo que la directora puede ir a mirar',
    (estado) => {
      expect(accesoModificar(estado, true)).toEqual({ permitido: false, motivo: 'en_remesa' })
    }
  )

  it('un borrador no se desconfirma: ya es editable', () => {
    expect(accesoModificar('borrador', false)).toEqual({
      permitido: false,
      motivo: 'no_confirmado',
    })
    // Ni siquiera si algo lo hubiera colado en una remesa: sigue sin haber nada que reabrir.
    expect(accesoModificar('borrador', true)).toEqual({
      permitido: false,
      motivo: 'no_confirmado',
    })
  })
})
