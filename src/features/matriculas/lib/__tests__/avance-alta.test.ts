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

/** Un alta recién invitada y aceptada: solo lo que ponen la invitación y aceptarla. */
const RECIEN_ACEPTADA: SenalesAvance = {
  normas: false,
  libroFamilia: false,
  imagen: false,
  dniTutor1: false,
  tutor2: false,
  medico: false,
  mandato: false,
  centroConCid: true,
}

const TODO_HECHO: SenalesAvance = {
  normas: true,
  libroFamilia: true,
  imagen: true,
  dniTutor1: true,
  tutor2: true,
  medico: true,
  mandato: true,
  centroConCid: true,
}

describe('Lo que lleva hecho un alta', () => {
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
    const senalDe: Record<ItemAvance, keyof SenalesAvance> = {
      normas: 'normas',
      nino: 'libroFamilia',
      imagen: 'imagen',
      tutor1: 'dniTutor1',
      tutor2: 'tutor2',
      medico: 'medico',
      sepa: 'mandato',
    }
    for (const item of ITEMS_AVANCE) {
      const lineas = avanceAlta({ ...RECIEN_ACEPTADA, [senalDe[item]]: true })
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

  it('cada bloque que exige el gate de finalizar tiene su línea, o lo pone la invitación', () => {
    const obligatorias = ITEMS_AVANCE.filter((i) => !ITEMS_OPCIONALES.has(i))
    const delGate = new Set(
      Object.values(LINEAS_DEL_GATE).flatMap((v) => (v === 'invitacion' ? [] : v))
    )
    // Lo que la lista marca como obligatorio es exactamente lo que el gate exige a la familia.
    expect([...delGate].sort()).toEqual([...obligatorias].sort())
    // Y lo que el gate ya da por hecho con la invitación es la identidad del niño y el nombre del
    // tutor 1: por eso no tienen línea (decían «hecho» desde el principio).
    const porInvitacion = Object.entries(LINEAS_DEL_GATE)
      .filter(([, v]) => v === 'invitacion')
      .map(([k]) => k)
      .sort()
    expect(porInvitacion).toEqual(['identidad', 'tutor1'])
  })
})
