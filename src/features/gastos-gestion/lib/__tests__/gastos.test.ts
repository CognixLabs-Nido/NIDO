import { describe, expect, it } from 'vitest'

import {
  ACCEPT_JUSTIFICANTE,
  deFilasNino,
  porContestar,
  rutaJustificanteDelNino,
  TIPOS_JUSTIFICANTE,
  type GastosCurso,
} from '../gastos'

/**
 * Fase 9 — lo puro de los gastos de gestión. Las reglas son espejos de la base: la ruta, del CHECK
 * `gastos_gestion_ruta_del_nino`; lo que falta por contestar, de `privado.gastos_sin_contestar`. Que
 * los tipos y el tope sean los del bucket lo compara `gastos-gestion.rls.test.ts` contra la base.
 */
describe('rutaJustificanteDelNino', () => {
  it.each(['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif'])('acepta .%s del propio niño', (ext) => {
    expect(rutaJustificanteDelNino(`c1/n1/justificante-3f2a.${ext}`, 'c1', 'n1')).toBe(true)
  })

  it.each([
    ['otro niño', 'c1/n2/j.pdf'],
    ['otro centro', 'c2/n1/j.pdf'],
    ['subcarpeta', 'c1/n1/sub/j.pdf'],
    ['escapa con ..', 'c1/n1/../n2/j.pdf'],
    ['tipo que el bucket no admite', 'c1/n1/j.exe'],
    ['sin extensión', 'c1/n1/j'],
    ['prefijo sin barra', 'c1/n1x/j.pdf'],
    ['mayúsculas en la extensión (el CHECK no las admite)', 'c1/n1/j.PDF'],
  ])('rechaza: %s', (_caso, ruta) => {
    expect(rutaJustificanteDelNino(ruta, 'c1', 'n1')).toBe(false)
  })

  it('la extensión que pone la subida para cada tipo la acepta la regla', () => {
    // Premisa: hay tipos.
    expect(Object.keys(TIPOS_JUSTIFICANTE).length).toBeGreaterThan(0)
    for (const ext of Object.values(TIPOS_JUSTIFICANTE))
      expect
        .soft(rutaJustificanteDelNino(`c1/n1/justificante-x.${ext}`, 'c1', 'n1'), ext)
        .toBe(true)
    expect(ACCEPT_JUSTIFICANTE.split(',')).toEqual(Object.keys(TIPOS_JUSTIFICANTE))
  })
})

const g = (p: Partial<GastosCurso>): GastosCurso => ({
  cursoId: 'k1',
  cursoNombre: '2026-27',
  importe: 6000,
  importeCurso: 6000,
  importePropio: false,
  forma: null,
  justificantePath: null,
  cobradoAt: null,
  matriculaPendiente: true,
  ...p,
})

describe('porContestar (espejo de privado.gastos_sin_contestar)', () => {
  it('premisa: sin forma, sin cobrar y con importe, falta', () => {
    expect(porContestar([g({})])).toHaveLength(1)
  })
  it.each([
    ['con forma', { forma: 'efectivo' as const }],
    ['transferencia sin justificante', { forma: 'transferencia' as const }],
    ['cobrado', { cobradoAt: '2026-11-16T10:00:00Z' }],
    ['importe 0', { importe: 0, importePropio: true }],
  ])('no falta: %s', (_caso, p) => {
    expect(porContestar([g(p)])).toEqual([])
  })
})

describe('deFilasNino', () => {
  it('traduce las columnas de gastos_gestion_nino y descarta una forma desconocida', () => {
    expect(
      deFilasNino([
        {
          curso_academico_id: 'k1',
          curso_nombre: '2026-27',
          importe_curso: 6000,
          importe: 0,
          importe_propio: true,
          forma: 'bizum',
          justificante_path: null,
          cobrado_at: null,
          matricula_pendiente: true,
        },
      ])
    ).toEqual([g({ importe: 0, importePropio: true, forma: null })])
  })

  it('una fila sin curso o sin importe no se inventa', () => {
    const base = {
      curso_nombre: 'x',
      importe_propio: false,
      forma: null,
      justificante_path: null,
      cobrado_at: null,
      matricula_pendiente: false,
    }
    expect(
      deFilasNino([
        { ...base, curso_academico_id: null, importe: 1, importe_curso: 1 },
        { ...base, curso_academico_id: 'k', importe: null, importe_curso: 1 },
      ])
    ).toEqual([])
  })
})
