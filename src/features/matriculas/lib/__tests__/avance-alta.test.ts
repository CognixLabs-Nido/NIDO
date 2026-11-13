import { describe, expect, it } from 'vitest'

import {
  avanceAlta,
  ITEMS_AVANCE,
  ITEMS_OPCIONALES,
  LINEAS_DEL_GATE,
  type ItemAvance,
  type SenalesAvance,
} from '../avance-alta'

/**
 * Lo que lleva hecho un alta (decisión de Jose, 2026-11-04). La directora lo mira para decidir si
 * llama, así que lo que importa es que ninguna línea diga «hecho» por algo que no hizo la familia.
 */

/** Las normas del centro, subidas, por firmar: la familia tiene algo que hacer. */
const NORMAS_POR_FIRMAR = { obligatorio: true, estado: 'por_firmar' } as const
const NORMAS_FIRMADAS = { obligatorio: true, estado: 'firmado' } as const

/** Un alta recién invitada y aceptada: solo lo que ponen la invitación y aceptarla. */
const RECIEN_ACEPTADA: SenalesAvance = {
  documentosCentro: [NORMAS_POR_FIRMAR],
  libroFamilia: false,
  imagen: false,
  tutor1: false,
  tutor2: 'no_hay',
  medico: false,
  mandato: false,
  centroConCid: true,
}

const TODO_HECHO: SenalesAvance = {
  documentosCentro: [NORMAS_FIRMADAS],
  libroFamilia: true,
  imagen: true,
  tutor1: true,
  tutor2: 'completo',
  medico: true,
  mandato: true,
  centroConCid: true,
}

describe('Lo que lleva hecho un alta', () => {
  it('un segundo tutor empezado y a medias es «falta», no «opcional sin hacer»: frena el cierre (fase 6)', () => {
    const l = avanceAlta({ ...RECIEN_ACEPTADA, tutor2: 'incompleto' }).find(
      (x) => x.item === 'tutor2'
    )
    expect(l?.estado).toBe('falta')
  })

  it('recién aceptada no tiene nada hecho: lo obligatorio falta y lo opcional queda neutro', () => {
    const lineas = avanceAlta(RECIEN_ACEPTADA)
    // Premisa: están todas las líneas, en el orden del wizard.
    expect(lineas.map((l) => l.item)).toEqual([...ITEMS_AVANCE])
    for (const l of lineas) {
      expect
        .soft(l.estado, l.item)
        .toBe(ITEMS_OPCIONALES.has(l.item) ? 'sin_hacer_opcional' : 'falta')
    }
  })

  it('cada línea pasa a hecha por su señal, y solo por la suya', () => {
    const senalDe: Record<ItemAvance, Partial<SenalesAvance>> = {
      documentos_centro: { documentosCentro: [NORMAS_FIRMADAS] },
      nino: { libroFamilia: true },
      imagen: { imagen: true },
      tutor1: { tutor1: true },
      tutor2: { tutor2: 'completo' },
      medico: { medico: true },
      sepa: { mandato: true },
    }
    for (const item of ITEMS_AVANCE) {
      const lineas = avanceAlta({ ...RECIEN_ACEPTADA, ...senalDe[item] })
      for (const l of lineas) {
        const esperado =
          l.item === item ? 'hecho' : ITEMS_OPCIONALES.has(l.item) ? 'sin_hacer_opcional' : 'falta'
        expect.soft(l.estado, `${item} → ${l.item}`).toBe(esperado)
      }
    }
  })

  it('todo hecho: todas las líneas hechas (control positivo)', () => {
    for (const l of avanceAlta(TODO_HECHO)) expect.soft(l.estado, l.item).toBe('hecho')
  })

  it('sin CID del centro no hay línea de SEPA, porque el paso no aparece', () => {
    const con = avanceAlta(TODO_HECHO).map((l) => l.item)
    const sin = avanceAlta({ ...TODO_HECHO, centroConCid: false }).map((l) => l.item)
    expect(con).toContain('sepa')
    expect(sin).not.toContain('sepa')
    expect(sin).toEqual(con.filter((i) => i !== 'sepa'))
  })

  it('los documentos del centro, con la regla del gate: hecho si no queda ninguno obligatorio por firmar', () => {
    const linea = (documentosCentro: SenalesAvance['documentosCentro']) =>
      avanceAlta({ ...RECIEN_ACEPTADA, documentosCentro }).find(
        (l) => l.item === 'documentos_centro'
      )?.estado
    // Premisa: con un obligatorio por firmar, la línea sale y falta.
    expect(linea([NORMAS_POR_FIRMAR])).toBe('falta')
    expect(linea([NORMAS_FIRMADAS])).toBe('hecho')
    // Uno que el centro no ha subido no frena (P-6), ni uno opcional por firmar.
    expect(linea([NORMAS_FIRMADAS, { obligatorio: true, estado: 'falta_documento' }])).toBe('hecho')
    expect(linea([NORMAS_FIRMADAS, { obligatorio: false, estado: 'por_firmar' }])).toBe('hecho')
    expect(linea([NORMAS_POR_FIRMAR, NORMAS_FIRMADAS])).toBe('falta')
  })

  it('sin nada obligatorio subido no hay línea de documentos: «hecho» diría que la familia hizo algo', () => {
    for (const documentosCentro of [
      [],
      [{ obligatorio: true, estado: 'falta_documento' }],
      [{ obligatorio: false, estado: 'por_firmar' }],
    ]) {
      const items = avanceAlta({ ...TODO_HECHO, documentosCentro }).map((l) => l.item)
      expect.soft(items, JSON.stringify(documentosCentro)).not.toContain('documentos_centro')
      // Y solo esa: el resto sigue.
      expect
        .soft(items, JSON.stringify(documentosCentro))
        .toEqual(ITEMS_AVANCE.filter((i) => i !== 'documentos_centro'))
    }
  })

  it('cada bloque que exige el gate de finalizar tiene su línea, o lo pone la invitación', () => {
    const obligatorias = ITEMS_AVANCE.filter((i) => !ITEMS_OPCIONALES.has(i))
    const delGate = new Set(
      Object.values(LINEAS_DEL_GATE).flatMap((v) => (v === 'invitacion' ? [] : v))
    )
    // Lo que la lista marca como obligatorio es lo que el gate exige a la familia, más el segundo
    // tutor, que es opcional pero, si lo hay, el gate lo exige entero (fase 6).
    expect([...delGate].sort()).toEqual([...obligatorias, 'tutor2'].sort())
    // Y lo que el gate ya da por hecho con la invitación es la identidad del niño: por eso no tiene
    // línea. El tutor 1 la tiene desde la fase 6 (sus datos los rellena la familia).
    const porInvitacion = Object.entries(LINEAS_DEL_GATE)
      .filter(([, v]) => v === 'invitacion')
      .map(([k]) => k)
      .sort()
    expect(porInvitacion).toEqual(['identidad'])
  })
})
