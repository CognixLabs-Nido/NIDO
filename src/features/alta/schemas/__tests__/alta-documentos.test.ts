import { describe, expect, it } from 'vitest'

import {
  actualizarNinoFamiliaSchema,
  estadoCivilEnum,
  guardarDatosTutorSchema,
  tipoVinculoLegalEnum,
} from '../alta-documentos'

const NINO = '11111111-1111-4111-8111-111111111111'

describe('alta-documentos schemas', () => {
  it('estadoCivilEnum acepta los 6 valores del ENUM y rechaza otros', () => {
    for (const v of [
      'casados',
      'separados',
      'divorciados',
      'pareja_de_hecho',
      'soltero',
      'viudo',
    ]) {
      expect(estadoCivilEnum.safeParse(v).success).toBe(true)
    }
    expect(estadoCivilEnum.safeParse('casado').success).toBe(false)
  })

  it('tipoVinculoLegalEnum excluye autorizado', () => {
    expect(tipoVinculoLegalEnum.safeParse('tutor_legal_principal').success).toBe(true)
    expect(tipoVinculoLegalEnum.safeParse('tutor_legal_secundario').success).toBe(true)
    expect(tipoVinculoLegalEnum.safeParse('autorizado').success).toBe(false)
  })

  it('actualizarNinoFamiliaSchema deja todo opcional salvo nino_id', () => {
    expect(actualizarNinoFamiliaSchema.safeParse({ nino_id: NINO }).success).toBe(true)
    expect(
      actualizarNinoFamiliaSchema.safeParse({ nino_id: NINO, estado_civil_familia: 'soltero' })
        .success
    ).toBe(true)
    expect(actualizarNinoFamiliaSchema.safeParse({ nino_id: 'no-uuid' }).success).toBe(false)
  })

  it('guardarDatosTutorSchema valida email y nombre cuando se aportan', () => {
    const ok = guardarDatosTutorSchema.safeParse({
      nino_id: NINO,
      tipo_vinculo: 'tutor_legal_principal',
      email: 'a@b.com',
      nombre_completo: 'Tutor Demo',
    })
    expect(ok.success).toBe(true)

    const badEmail = guardarDatosTutorSchema.safeParse({
      nino_id: NINO,
      tipo_vinculo: 'tutor_legal_principal',
      email: 'no-es-email',
    })
    expect(badEmail.success).toBe(false)

    const shortName = guardarDatosTutorSchema.safeParse({
      nino_id: NINO,
      tipo_vinculo: 'tutor_legal_secundario',
      nombre_completo: 'X',
    })
    expect(shortName.success).toBe(false)
  })
})
