import { describe, expect, it } from 'vitest'

import { destinatariosDeAdminFamilia } from '../audiencia'

/**
 * `destinatariosDeAdminFamilia` (item 5) es pura: el destinatario de un
 * mensaje en una conversación admin↔familia es el OTRO miembro del par
 * (admin_id, tutor_id), excluyendo al autor. Push incondicional — sin
 * gateo por `puede_recibir_mensajes` (ver docstring de la función).
 */

const ADMIN = 'admin-1'
const TUTOR = 'tutor-1'

describe('destinatariosDeAdminFamilia', () => {
  it('autor admin → el tutor recibe', () => {
    expect(destinatariosDeAdminFamilia(ADMIN, TUTOR, ADMIN)).toEqual([TUTOR])
  })

  it('autor tutor → el admin recibe', () => {
    expect(destinatariosDeAdminFamilia(ADMIN, TUTOR, TUTOR)).toEqual([ADMIN])
  })

  it('autor ajeno al par (no debería pasar) → ambos, defensivo', () => {
    expect(destinatariosDeAdminFamilia(ADMIN, TUTOR, 'otro')).toEqual([ADMIN, TUTOR])
  })

  it('admin == tutor (caso degenerado) → vacío, no se auto-notifica', () => {
    expect(destinatariosDeAdminFamilia(ADMIN, ADMIN, ADMIN)).toEqual([])
  })
})
