import { describe, expect, it } from 'vitest'

import { elegirAdultoConCuenta, type TutorFamiliaMinimo } from '../adulto-con-cuenta'

/**
 * F-2b-4-2 — la resolución del adulto CON CUENTA gobierna (a) qué usuario_id se pasa a la
 * RPC y (b) qué nombre_completo se pasa como `p_tutor_nombre_completo` (el GUARDADO, no el
 * tecleado → neutraliza la colisión). Y decide la elegibilidad de la familia.
 */
describe('elegirAdultoConCuenta', () => {
  it('prefiere el titular con cuenta y devuelve su nombre GUARDADO exacto', () => {
    const tutores: TutorFamiliaMinimo[] = [
      { usuario_id: 'u-seg', nombre_completo: 'Segundo Tutor', email: 's@x.com', rol_familia: 'segundo_tutor' },
      { usuario_id: 'u-tit', nombre_completo: 'María Titular', email: 't@x.com', rol_familia: 'titular' },
    ]
    const r = elegirAdultoConCuenta(tutores)
    expect(r).not.toBeNull()
    expect(r!.usuarioId).toBe('u-tit') // titular preferido
    expect(r!.nombreCompleto).toBe('María Titular') // el guardado, no el tecleado
    expect(r!.email).toBe('t@x.com')
  })

  it('usa el segundo_tutor con cuenta si el titular NO tiene cuenta (invitación pendiente)', () => {
    const tutores: TutorFamiliaMinimo[] = [
      { usuario_id: null, nombre_completo: 'Titular Sin Cuenta', email: 't@x.com', rol_familia: 'titular' },
      { usuario_id: 'u-seg', nombre_completo: 'Segundo Con Cuenta', email: 's@x.com', rol_familia: 'segundo_tutor' },
    ]
    const r = elegirAdultoConCuenta(tutores)
    expect(r!.usuarioId).toBe('u-seg')
    expect(r!.nombreCompleto).toBe('Segundo Con Cuenta')
  })

  it('rechaza (null) una familia sin NINGÚN adulto con cuenta → no elegible', () => {
    const tutores: TutorFamiliaMinimo[] = [
      { usuario_id: null, nombre_completo: 'Titular Invitado', email: 't@x.com', rol_familia: 'titular' },
      { usuario_id: null, nombre_completo: 'Segundo Invitado', email: 's@x.com', rol_familia: 'segundo_tutor' },
    ]
    expect(elegirAdultoConCuenta(tutores)).toBeNull()
  })

  it('familia vacía → null', () => {
    expect(elegirAdultoConCuenta([])).toBeNull()
  })
})
