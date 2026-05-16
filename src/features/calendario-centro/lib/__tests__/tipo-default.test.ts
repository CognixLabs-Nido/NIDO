import { describe, expect, it } from 'vitest'

import { tipoAbreElCentro, tipoDefaultDeFecha } from '../tipo-default'

describe('tipoDefaultDeFecha', () => {
  it('lunes a viernes → lectivo', () => {
    // Junio 2026: lunes 1, martes 2, miércoles 3, jueves 4, viernes 5.
    expect(tipoDefaultDeFecha(new Date(2026, 5, 1))).toBe('lectivo')
    expect(tipoDefaultDeFecha(new Date(2026, 5, 2))).toBe('lectivo')
    expect(tipoDefaultDeFecha(new Date(2026, 5, 3))).toBe('lectivo')
    expect(tipoDefaultDeFecha(new Date(2026, 5, 4))).toBe('lectivo')
    expect(tipoDefaultDeFecha(new Date(2026, 5, 5))).toBe('lectivo')
  })

  it('sábado y domingo → cerrado', () => {
    // Junio 2026: sábado 6, domingo 7.
    expect(tipoDefaultDeFecha(new Date(2026, 5, 6))).toBe('cerrado')
    expect(tipoDefaultDeFecha(new Date(2026, 5, 7))).toBe('cerrado')
  })
})

describe('tipoAbreElCentro', () => {
  it('lectivo / escuela_verano / escuela_navidad / jornada_reducida → abierto', () => {
    expect(tipoAbreElCentro('lectivo')).toBe(true)
    expect(tipoAbreElCentro('escuela_verano')).toBe(true)
    expect(tipoAbreElCentro('escuela_navidad')).toBe(true)
    expect(tipoAbreElCentro('jornada_reducida')).toBe(true)
  })

  it('festivo / vacaciones / cerrado → cerrado', () => {
    expect(tipoAbreElCentro('festivo')).toBe(false)
    expect(tipoAbreElCentro('vacaciones')).toBe(false)
    expect(tipoAbreElCentro('cerrado')).toBe(false)
  })
})
