import { describe, expect, it } from 'vitest'

import { chocaConLaAdminViva } from '../escribir-roles'

/**
 * La aceptación de una invitación de admin da su mensaje propio solo si el 23505 es el del índice
 * de una admin viva por centro: el centro consiguió admin entre la invitación y la aceptación.
 */
describe('chocaConLaAdminViva', () => {
  const MENSAJE =
    'duplicate key value violates unique constraint "idx_roles_usuario_una_admin_viva"'

  it('el 23505 del índice de una admin viva', () => {
    expect(chocaConLaAdminViva({ code: '23505', message: MENSAJE })).toBe(true)
  })

  it.each([
    [
      'otro 23505',
      { code: '23505', message: 'violates unique constraint "roles_usuario_viva_key"' },
    ],
    ['otro código con el mismo nombre', { code: '55000', message: MENSAJE }],
    ['sin mensaje', { code: '23505' }],
    ['sin error', null],
  ])('%s: no', (_caso, error) => {
    expect(chocaConLaAdminViva(error)).toBe(false)
  })
})
