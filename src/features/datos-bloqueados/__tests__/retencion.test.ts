// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { claveSujeto, filtrarSujetos, type SujetoListado } from '../lib/filtrar-retencion'
import {
  MOTIVOS_TIPO,
  PonerRetencionSchema,
  QuitarRetencionSchema,
  RETENCION_MAX_SUJETOS,
} from '../types'

const MIGRACION = readFileSync(
  path.resolve(
    __dirname,
    '../../../../supabase/migrations/20261206120000_feat_retencion_retenciones.sql'
  ),
  'utf8'
)

const ID = '11111111-1111-4111-8111-111111111111'

function s(over: Partial<SujetoListado>): SujetoListado {
  return {
    sujeto_tipo: 'nino',
    sujeto_id: ID,
    nombre: 'Íñigo Demo',
    familia: 'García',
    aula: 'Pollitos',
    estado: 'activo',
    retenido_desde: null,
    ...over,
  }
}

const TODO = {
  aula: null,
  texto: '',
  tipo: 'todos',
  estado: 'todos',
  soloRetenidos: false,
} as const

describe('retención: el filtro del listado', () => {
  const lista = [
    s({ sujeto_id: 'a', nombre: 'Íñigo Demo', aula: 'Pollitos' }),
    s({
      sujeto_id: 'b',
      nombre: '[borrado]',
      familia: 'Martínez',
      estado: 'purgado',
      aula: 'Patitos',
    }),
    s({
      sujeto_id: 'c',
      sujeto_tipo: 'usuario',
      nombre: 'Madre Demo',
      aula: 'Pollitos',
      estado: 'baja',
    }),
    s({ sujeto_id: 'd', nombre: 'Bea Demo', retenido_desde: '2027-01-02T10:00:00Z' }),
  ]
  const ids = (f: Partial<typeof TODO> | Record<string, unknown>) =>
    filtrarSujetos(lista, { ...TODO, ...f } as typeof TODO).map((x) => x.sujeto_id)

  it('sin filtro, todos', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd'])
  })

  it('por tipo, estado, clase y solo los retenidos', () => {
    expect(ids({ tipo: 'usuario' })).toEqual(['c'])
    expect(ids({ tipo: 'nino' })).toEqual(['a', 'b', 'd'])
    expect(ids({ estado: 'purgado' })).toEqual(['b'])
    expect(ids({ aula: 'Patitos' })).toEqual(['b'])
    expect(ids({ soloRetenidos: true })).toEqual(['d'])
  })

  it('al purgado se le encuentra por su familia, y sin acentos', () => {
    expect(ids({ texto: 'martinez' })).toEqual(['b'])
    expect(ids({ texto: 'inigo' })).toEqual(['a'])
  })

  it('un niño y un adulto con el mismo id no se confunden en la selección', () => {
    expect(claveSujeto({ sujeto_tipo: 'nino', sujeto_id: ID })).not.toBe(
      claveSujeto({ sujeto_tipo: 'usuario', sujeto_id: ID })
    )
  })
})

describe('retención: lo que se manda a la BD', () => {
  const base = {
    centroId: ID,
    sujetos: [{ tipo: 'nino', id: ID }],
    motivoTipo: 'juzgado',
    motivo: 'Oficio 12/2027 del juzgado',
  }

  it('poner pide tipo y motivo de 10 a 1000; quitar, solo el motivo', () => {
    expect(PonerRetencionSchema.safeParse(base).success).toBe(true)
    expect(PonerRetencionSchema.safeParse({ ...base, motivo: '  corto   ' }).success).toBe(false)
    expect(PonerRetencionSchema.safeParse({ ...base, motivoTipo: 'nada' }).success).toBe(false)
    expect(PonerRetencionSchema.safeParse({ ...base, sujetos: [] }).success).toBe(false)
    expect(
      PonerRetencionSchema.safeParse({ ...base, sujetos: [{ tipo: 'familia', id: ID }] }).success
    ).toBe(false)
    expect(QuitarRetencionSchema.safeParse({ ...base, motivoTipo: undefined }).success).toBe(true)
    expect(QuitarRetencionSchema.safeParse({ ...base, motivo: 'corto' }).success).toBe(false)
  })

  it('los tipos de motivo y el tope de sujetos son los de la migración', () => {
    const check = MIGRACION.match(
      /motivo_tipo\s+text NOT NULL CHECK \(motivo_tipo IN \(([^)]*)\)\)/
    )
    expect(check).not.toBeNull()
    const enBd = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(enBd).toEqual([...MOTIVOS_TIPO])
    expect(MIGRACION).toContain(`IF v_n NOT BETWEEN 1 AND ${RETENCION_MAX_SUJETOS} THEN`)
  })

  it('cada texto de la retención existe en es, en y va', () => {
    type Arbol = { [k: string]: string | Arbol }
    const claves = (o: Arbol, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'string' ? [`${p}${k}`] : claves(v, `${p}${k}.`)
      )
    const de = (m: unknown) =>
      claves((m as { datos_bloqueados: { retencion: Arbol } }).datos_bloqueados.retencion).sort()
    expect(de(es).length).toBeGreaterThan(20)
    expect(de(en)).toEqual(de(es))
    expect(de(va)).toEqual(de(es))
  })
})
