import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import es from '../../../../messages/es.json'
import va from '../../../../messages/va.json'

import { lineasEstado } from '../lib/lineas-estado'
import type { EstadoRetencionNino } from '../queries/get-estado-retencion-nino'

type EnBaja = Exclude<EstadoRetencionNino, { estado: 'activo' }>

const base: EnBaja = {
  estado: 'baja',
  baja: '1996-03-01',
  retenido: false,
  puede_ver_bloqueado: false,
  medicos: {
    estado: 'bloqueados',
    desde: '1996-08-01',
    borrado: { estado: 'se_borrara', hasta: '2046-03-02' },
  },
  operativa: { estado: 'por_partes', hasta: '2046-08-01' },
  firmas: { estado: 'a_la_vista', hasta: '2046-03-02' },
  expediente: { estado: 'se_borrara', hasta: '2046-03-02' },
  fiscal: { estado: 'a_la_vista', hasta: '2052-08-01', vencido: false, desde_pago: true },
  cuentas: [
    {
      usuario_id: '11111111-1111-4111-8111-111111111111',
      nombre: 'Tutora Demo',
      estado: 'se_borrara',
      hasta: '2050-03-02',
      baja_ultimo_hijo: '2000-03-01',
      por_otro_hijo: true,
    },
  ],
}

/** Cada estado y motivo que devuelve `estado_retencion_nino`, en alguna línea. */
const variantes: EnBaja[] = [
  base,
  {
    ...base,
    estado: 'purgado',
    medicos: { estado: 'borrados', desde: '2026-06-15' },
    operativa: { estado: 'borrado', desde: '2026-06-15' },
    firmas: { estado: 'bloqueados', desde: '2026-06-15', hasta: '2046-03-02', vencido: false },
    expediente: { estado: 'borrado', desde: '2026-06-15' },
    fiscal: { estado: 'a_la_vista', hasta: '2020-08-01', vencido: true, desde_pago: false },
    cuentas: [{ ...base.cuentas[0], estado: 'borrada', desde: '2026-06-15', nombre: null }],
  },
  {
    ...base,
    retenido: true,
    medicos: {
      estado: 'a_la_vista',
      desde: null,
      borrado: { estado: 'sin_fecha', motivo: 'retenido' },
    },
    operativa: { estado: 'sin_fecha', motivo: 'sin_curso' },
    firmas: { estado: 'bloqueados', desde: '2026-06-15', motivo: 'retenido' },
    expediente: { estado: 'vencido', hasta: '2016-03-02' },
    fiscal: {
      estado: 'sin_fecha',
      motivos: ['otro_hijo', 'dinero_pendiente', 'retenido', 'sin_curso'],
    },
    cuentas: ['otro_hijo', 'trabaja_en_centro', 'retenido', 'dinero_pendiente', 'otro_bloqueo'].map(
      (motivo, i) => ({
        ...base.cuentas[0],
        usuario_id: `1111111${i}-1111-4111-8111-111111111111`,
        estado: 'sin_fecha',
        motivo,
        por_otro_hijo: false,
      })
    ),
  },
  {
    ...base,
    operativa: { estado: 'nada' },
    firmas: { estado: 'nada' },
    medicos: { ...base.medicos, borrado: { estado: 'vencido', hasta: '2016-03-02' } },
    cuentas: [{ ...base.cuentas[0], estado: 'vencido', hasta: '2016-03-02' }],
  },
  {
    ...base,
    operativa: { estado: 'vencido', hasta: '1997-08-01' },
    firmas: { estado: 'a_la_vista', hasta: '2046-03-02', motivo: 'retenido' },
  },
]

function valor(msgs: unknown, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      msgs
    )
}

describe('lineasEstado', () => {
  it('traduce sin calcular: cada fecha es la que dice la BD, y la cuenta dice desde qué baja cuenta', () => {
    const t = (k: string, v?: Record<string, string>) => `${k}${v ? JSON.stringify(v) : ''}`
    const lineas = lineasEstado(base, t, (iso) => `<${iso}>`)
    expect(lineas.map((l) => l.clave)).toEqual([
      'medicos',
      'operativa',
      'firmas',
      'fiscal',
      'cuenta:11111111-1111-4111-8111-111111111111',
      'expediente',
    ])
    const texto = Object.fromEntries(lineas.map((l) => [l.clave, l.texto]))
    expect(texto.medicos).toBe(
      'medicos.bloqueados{"fecha":"<1996-08-01>"} · se_borrara{"fecha":"<2046-03-02>"}'
    )
    expect(texto['cuenta:11111111-1111-4111-8111-111111111111']).toBe(
      'se_borrara{"fecha":"<2050-03-02>"} · cuenta.por_otro_hijo{"fecha":"<2000-03-01>"}'
    )
    expect(texto.fiscal).toBe('fiscal.a_la_vista{"fecha":"<2052-08-01>"} (fiscal.desde_pago)')
  })

  it('todas las claves que usa existen en es, en y va', () => {
    const usadas = new Set<string>()
    const t = (k: string) => {
      usadas.add(k)
      return k
    }
    for (const v of variantes) lineasEstado(v, t, (iso) => iso)
    // Premisa: el recorrido toca los motivos de la cuenta y de lo fiscal.
    expect(usadas).toContain('cuenta.motivos.otro_bloqueo')
    expect(usadas).toContain('fiscal.motivos.sin_curso')
    for (const msgs of [es, en, va]) {
      const faltan = [...usadas].filter(
        (k) => typeof valor((msgs as Record<string, unknown>).retencion_estado, k) !== 'string'
      )
      expect(faltan).toEqual([])
    }
  })

  it('un estado que no conoce sale con su código, nunca callado', () => {
    const t = (k: string) => k
    const lineas = lineasEstado({ ...base, operativa: { estado: 'nuevo_estado' } }, t, (iso) => iso)
    expect(lineas.find((l) => l.clave === 'operativa')?.texto).toBe('nuevo_estado')
  })
})
