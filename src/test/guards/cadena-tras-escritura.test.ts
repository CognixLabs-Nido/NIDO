// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cadena = require('../../../scripts/ci/cadena-tras-escritura.cjs')
const { analizar, volatilidadDeMigraciones, leerLista } = cadena

/**
 * El escáner de cadena del censo C (decisiones de Jose del 2026-11-25): sus casos, con la respuesta
 * escrita antes, sobre un árbol de mentira en una carpeta temporal. Si el escáner deja de seguir la cadena
 * de llamadas, o de ver un catch que dice «no», o la frontera de las acciones, esto se pone rojo.
 */

const BASE = `
export class LecturaFallida extends Error { constructor(a: string, b: unknown) { super(a) } }
export function fail(e: string) { return { success: false as const, error: e } }
export function ok<T>(d: T) { return { success: true as const, data: d } }
export async function siFallaTrasEscribir<T>(_d: string, p: Promise<T>, x: T): Promise<T> { try { return await p } catch { return x } }
export function falloDeLectura(_e: unknown) { return { success: false as const, error: 'common.lectura_fallida' } }
declare const db: any
export async function leeOLanza() { const { data, error } = await db.from('t').select('id'); if (error) throw new LecturaFallida('leeOLanza', error); return data }
export async function escribeYLanza() { await db.from('t').insert({}); const { error } = await db.from('u').select(); if (error) throw new LecturaFallida('escribeYLanza', error) }
export async function otraQueLanza() { const { error } = await db.from('v').select(); if (error) throw new LecturaFallida('otraQueLanza', error) }
export async function lanzaYEscribe() { const { error } = await db.from('u').select(); if (error) throw new LecturaFallida('x', error); await db.from('t').insert({}) }
export async function oNoLeido<T>(p: Promise<T>, _d: string): Promise<T | null> { try { return await p } catch { return null } }
export async function envuelveSinMirar<T>(p: Promise<T>): Promise<T> { return await p }
`
const ACCIONES = `'use server'
import { leeOLanza, escribeYLanza, otraQueLanza, fail, ok, siFallaTrasEscribir, falloDeLectura, oNoLeido, envuelveSinMirar } from '../lib/base'
declare const db: any
export async function accion1() { await db.from('t').update({}).eq('id', 1); await leeOLanza(); return ok(1) }
export async function accion2() { try { await leeOLanza(); await db.from('t').insert({}); return ok(1) } catch (e) { return falloDeLectura(e) } }
export async function accion3() { await db.from('t').insert({}); try { await leeOLanza() } catch { return ok(0) } return ok(1) }
export async function accion4() { await escribeYLanza(); return ok(1) }
export const accion5 = async () => { await db.rpc('hacer_x'); const { error } = await db.from('u').select(); if (error) return fail('common.lectura_fallida'); return ok(1) }
export async function accion6() { await db.rpc('leer_x'); const { error } = await db.from('u').select(); if (error) return fail('common.lectura_fallida'); return ok(1) }
export async function accion7() { await db.storage.from('b').remove(['x']); await leeOLanza(); return ok(1) }
export async function accion8() { await db.from('t').insert({}); try { await leeOLanza() } catch { return fail('x') } return ok(1) }
export async function accion9() { await db.from('t').insert({}); const v = await siFallaTrasEscribir('x', leeOLanza(), null); return ok(v) }
export async function accion11() { await db.from('t').insert({}); await leeOLanza(); await otraQueLanza(); return ok(1) }
export async function accion10() { try { await db.from('t').insert({}); await leeOLanza(); return ok(1) } catch (e) { return falloDeLectura(e) } }
// oNoLeido recoge la LecturaFallida y devuelve null: no deja escapar nada (fetchAgendaDelDia, censo C B1).
export async function accion12() { return oNoLeido(leeOLanza(), 'x') }
// El control: un envoltorio que no la recoge sí la deja escapar. Cuenta el NOMBRE, no la forma.
export async function accion13() { return envuelveSinMirar(leeOLanza()) }
`
// La respuesta, escrita antes de correrlo.
const ENTRADAS = ['accion1', 'accion10', 'accion11', 'accion4', 'accion5', 'accion7', 'accion8']
const LANZAN = ['accion1', 'accion11', 'accion13', 'accion4', 'accion7']

let dir = ''
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadena-'))
  fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src/actions'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: false,
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        noEmit: true,
      },
      include: ['src/**/*.ts'],
    })
  )
  fs.writeFileSync(path.join(dir, 'src/lib/base.ts'), BASE)
  fs.writeFileSync(path.join(dir, 'src/actions/acciones.ts'), ACCIONES)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const nombres = (xs: string[]) => xs.map((x) => x.split('#')[1]).sort()
const VOL = new Map([
  ['leer_x', 's'],
  ['hacer_x', 'v'],
])

// Construir un programa de TypeScript carga las librerías por defecto: con la máquina cargada, el primero
// pasa de los 15 s por defecto (medido el 2026-11-25).
describe(
  'escáner de cadena: «se guardó y te digo que no» y la frontera de las acciones',
  { timeout: 120_000 },
  () => {
    it('cada caso, como estaba escrito antes', () => {
      const r = analizar(dir, VOL)
      expect(nombres(r.entradas)).toEqual([...ENTRADAS].sort())
      expect(nombres(r.accionesQueLanzan)).toEqual([...LANZAN].sort())
      expect(r.rpcsDesconocidas).toEqual([])
    })

    it('enseña TODAS las paradas, hasta sus hojas: una función con dos helpers que paran da los dos', () => {
      const r = analizar(dir, VOL)
      // Las dos hojas: el throw de leeOLanza (línea 8 de base.ts) y el de otraQueLanza (línea 10).
      expect(r.raicesDe['src/actions/acciones.ts#accion11']).toEqual([
        'src/lib/base.ts:10 throw LecturaFallida',
        'src/lib/base.ts:8 throw LecturaFallida',
      ])
    })

    it('control: con la RPC de escritura tomada por lectura, el caso 5 desaparece (la volatilidad cuenta)', () => {
      const r = analizar(
        dir,
        new Map([
          ['leer_x', 's'],
          ['hacer_x', 's'],
        ])
      )
      expect(nombres(r.entradas)).not.toContain('accion5')
      expect(nombres(r.entradas)).toContain('accion1')
    })

    it('una RPC que no está en las migraciones cuenta como escritura, y se dice', () => {
      const r = analizar(dir, new Map([['leer_x', 's']]))
      expect(nombres(r.entradas)).toContain('accion5')
      expect(r.rpcsDesconocidas).toEqual(['hacer_x'])
    })

    it('la volatilidad sale de la última definición en las migraciones, delante o detrás del cuerpo', () => {
      const m = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
      try {
        fs.writeFileSync(
          path.join(m, '1.sql'),
          `CREATE FUNCTION public.a() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;\nCREATE OR REPLACE FUNCTION b() RETURNS int AS $f$ SELECT 1 $f$ LANGUAGE sql IMMUTABLE;\nCREATE FUNCTION public.c() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;`
        )
        fs.writeFileSync(
          path.join(m, '2.sql'),
          `CREATE OR REPLACE FUNCTION public.a() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;`
        )
        const v = volatilidadDeMigraciones(m)
        expect(Object.fromEntries(v)).toEqual({ a: 'v', b: 'i', c: 'v' })
      } finally {
        fs.rmSync(m, { recursive: true, force: true })
      }
    })
  }
)

describe('la lista y su norma (Jose, 2026-11-27): un pendiente entra con destino y fecha; una excusa, nunca', () => {
  // La respuesta, escrita antes de correrlo.
  const lista = {
    _norma: 'texto de la norma: no es una entrada',
    'a.ts#explicada': 'Falso positivo: la escritura está en una rama que devuelve antes.',
    'b.ts#tratada': 'Tratado: el llamador dice lo guardado y lo que no.',
    'c.ts#huerfano': 'Fichero huérfano, la base no cambió.',
    'd.ts#pendiente': 'Pendiente · Destino: PR B2 · 2026-11-27: el doble fallo, con su diseño.',
    'e.ts#sinFecha': 'Pendiente · Destino: PR B2: sin fecha.',
    'f.ts#sinDestino': 'Pendiente · 2026-11-27: sin PR destino.',
    'g.ts#excusa': 'Se arreglará más adelante.',
  }
  it('premisa: _norma no cuenta como entrada, y las demás sí', () => {
    expect(leerLista(lista).entradas).toHaveLength(7)
    expect(leerLista(lista).entradas).not.toContain('_norma')
  })
  it('sin destino, sin fecha o sin clase: fuera (la CI roja); con clase o con destino y fecha: dentro', () => {
    expect(leerLista(lista).sinClase).toEqual(['e.ts#sinFecha', 'f.ts#sinDestino', 'g.ts#excusa'])
  })
  it('la lista de verdad la cumple entera', () => {
    const real = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../../scripts/ci/cadena-tras-escritura.lista.json'),
        'utf8'
      )
    )
    expect(leerLista(real).entradas.length).toBeGreaterThan(0)
    expect(leerLista(real).sinClase).toEqual([])
  })
})
