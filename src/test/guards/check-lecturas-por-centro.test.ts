// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { leerCatalogo, revisar, SIN_CENTRO } from '../../../scripts/check-lecturas-por-centro.mjs'

/**
 * El guard de las lecturas acotadas al centro (PR 0 de la Fase 5). La RLS dice quién ve una fila,
 * no de qué centro es la página: al superusuario y a quien tiene rol en dos centros les devuelve
 * las de todos. El primer bloque mira el árbol de verdad; el segundo demuestra que caza, con un
 * árbol de mentira donde cada caso tiene que ponerse rojo, y el catálogo con las dos formas que
 * rompieron la primera versión (`Relationships: []` y una FK compuesta).
 */

const RAIZ = path.resolve(__dirname, '../../..')

describe('el árbol real cumple', () => {
  it('sin problemas, y con el recuento impreso', () => {
    const { problemas, recuento, marcas } = revisar(RAIZ)
    expect(problemas).toEqual([])
    // Premisa: el guard ha leído el árbol y el catálogo (sin catálogo, ninguna cadena cuenta).
    expect(recuento.ficherosRevisados).toBeGreaterThan(500)
    expect(recuento.cadenas).toBeGreaterThan(700)
    expect(recuento.acotadas).toBeGreaterThan(600)
    // Las lecturas entre centros con su motivo: una nueva sube este número a propósito.
    expect(recuento.marcadas).toBe(25)
    expect(marcas.every((m) => m.motivo.length >= 10)).toBe(true)
  })

  it('el catálogo real: todas las tablas, las FK compuestas y las de usuarios fuera', () => {
    const tablas = leerCatalogo(readFileSync(path.join(RAIZ, 'src/types/database.ts'), 'utf8'))
    expect(tablas.size).toBeGreaterThan(70)
    // `matriculas` → `aulas_curso (aula_id, curso_academico_id)`: las dos columnas fijan.
    expect([...tablas.get('matriculas')!.fijan].sort()).toEqual(
      ['aula_id', 'curso_academico_id', 'id', 'nino_id'].sort()
    )
    // `vinculos_familiares.usuario_id` → `usuarios`: no fija (la persona está en varios centros).
    expect(tablas.get('vinculos_familiares')!.fijan.has('usuario_id')).toBe(false)
    expect(tablas.get('roles_usuario')!.fijan.has('centro_id')).toBe(true)
    for (const t of Object.keys(SIN_CENTRO)) expect(tablas.has(t)).toBe(true)
  })
})

/** Un `database.ts` mínimo con la forma del generado. */
const DATABASE = `export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      autorizaciones: {
        Row: {
          centro_id: string
          id: string
          tipo: string
        }
        Insert: {
          centro_id: string
        }
        Relationships: []
      }
      matriculas: {
        Row: {
          aula_id: string
          curso_academico_id: string
          estado: string
          id: string
          nino_id: string
        }
        Relationships: [
          {
            foreignKeyName: "matriculas_aula_curso_fkey"
            columns: ["aula_id", "curso_academico_id"]
            isOneToOne: false
            referencedRelation: "aulas_curso"
            referencedColumns: ["aula_id", "curso_academico_id"]
          },
          {
            foreignKeyName: "matriculas_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      preferencias_usuario: {
        Row: {
          clave: string
          usuario_id: string
        }
        Relationships: []
      }
      auth_attempts: {
        Row: {
          id: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          usuario_id: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
        }
        Relationships: []
      }
      roles_usuario: {
        Row: {
          centro_id: string
          id: string
          usuario_id: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_usuario_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
  }
}
`

describe('caza lo que tiene que cazar (árbol de mentira)', () => {
  let raiz: string

  function fichero(rel: string, contenido: string) {
    const abs = path.join(raiz, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenido)
  }

  /** Un árbol con el catálogo y un único fichero con `cuerpo`. */
  function arbol(cuerpo: string) {
    raiz = mkdtempSync(path.join(tmpdir(), 'guard-lecturas-'))
    fichero('src/types/database.ts', DATABASE)
    fichero('src/features/x/q.ts', cuerpo)
    return revisar(raiz)
  }

  afterEach(() => rmSync(raiz, { recursive: true, force: true }))

  it('control: acotada por centro_id, por un embebido o por una FK que fija, pasa', () => {
    const r = arbol(`
      export async function a(s, c) {
        await s.from('autorizaciones').select('id').eq('centro_id', c)
        await s.from('matriculas').select('id, nino:ninos!inner(centro_id)').eq('nino.centro_id', c)
        await s.from('matriculas').select('id').in('aula_id', [c])
      }
    `)
    expect(r.problemas).toEqual([])
    expect(r.recuento.acotadas).toBe(3)
  })

  it('una lectura sin centro, rojo', () => {
    const r = arbol(`export const a = (s) => s.from('autorizaciones').select('id').eq('tipo', 'x')`)
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0]).toContain("q.ts:1: .from('autorizaciones') no filtra por centro_id")
  })

  it('filtrar por una FK a usuarios no fija el centro, rojo', () => {
    const r = arbol(
      `export const a = (s, u) => s.from('roles_usuario').select('id').eq('usuario_id', u)`
    )
    expect(r.problemas).toHaveLength(1)
  })

  it('un UPDATE o un DELETE sin centro, rojo; un INSERT y un UPSERT no entran', () => {
    const r = arbol(`
      export async function a(s) {
        await s.from('autorizaciones').update({ tipo: 'x' }).eq('tipo', 'y')
        await s.from('autorizaciones').delete().eq('tipo', 'y')
        await s.from('autorizaciones').insert({ centro_id: 'c' })
        await s.from('autorizaciones').upsert({ centro_id: 'c' })
      }
    `)
    expect(r.problemas).toHaveLength(2)
    expect(r.recuento.escrituras).toBe(2)
  })

  it('un filtro añadido después en una variable no cuenta, rojo', () => {
    const r = arbol(`
      export async function a(s, c) {
        let q = s.from('autorizaciones').select('id')
        q = q.eq('centro_id', c)
        return q
      }
    `)
    expect(r.problemas).toHaveLength(1)
  })

  it('con su marca y su motivo pasa; con un motivo corto, rojo', () => {
    const bien = arbol(`
      export async function a(s) {
        // entre-centros: el barrido del servidor recorre todos los centros.
        await s.from('autorizaciones').select('id')
      }
    `)
    expect(bien.problemas).toEqual([])
    expect(bien.recuento.marcadas).toBe(1)
    rmSync(raiz, { recursive: true, force: true })
    const corta = arbol(`
      export async function a(s) {
        // entre-centros: ídem.
        await s.from('autorizaciones').select('id')
      }
    `)
    expect(corta.problemas).toHaveLength(1)
  })

  it('una marca sobre una consulta que ya filtra, rojo (el motivo ya no es verdad)', () => {
    const r = arbol(`
      export async function a(s, c) {
        // entre-centros: el barrido del servidor recorre todos los centros.
        await s.from('autorizaciones').select('id').eq('centro_id', c)
      }
    `)
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0]).toContain('ya filtra por centro')
  })

  it('en un Promise.all la marca cubre solo su elemento, no los de al lado', () => {
    const r = arbol(`
      export async function a(s) {
        await Promise.all([
          // entre-centros: el barrido del servidor recorre todos los centros.
          s.from('autorizaciones').select('id'),
          s.from('matriculas').select('id'),
        ])
      }
    `)
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0]).toContain("from('matriculas')")
  })

  it('las tablas sin centro no entran; una tabla fuera del catálogo, rojo', () => {
    const r = arbol(`
      export async function a(s, u) {
        await s.from('preferencias_usuario').select('clave').eq('usuario_id', u)
        await s.from('no_existe').select('id')
      }
    `)
    expect(r.recuento.sinCentro).toBe(1)
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0]).toContain('no está en el catálogo')
  })

  it('tabla variable: por id pasa, sin id rojo; Buffer.from, Array.from y Storage no son tablas', () => {
    const r = arbol(`
      export async function a(s, t, id, b) {
        await s.from(t).select('x').eq('id', id)
        await s.from(t).select('x').eq('tipo', 'y')
        Buffer.from(b)
        Array.from(b)
        await s.storage.from('bucket').remove(['x'])
      }
    `)
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0]).toContain('tabla variable')
    expect(r.recuento.cadenas).toBe(2)
  })
})
