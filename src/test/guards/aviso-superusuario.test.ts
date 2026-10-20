// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * Dentro de un centro, el superusuario ve siempre el aviso (`AvisoSuperusuario`, ADR-0061): está
 * viendo datos de un centro cliente con permisos totales. Este censo recorre las páginas y los
 * layouts que leen el centro activo (`requireContextoCentro` / `getEstadoCentro`) y exige que
 * cada uno quede debajo de un layout que monte el aviso, o esté en la lista con su motivo. Un
 * árbol de rutas nuevo sin aviso se pone rojo aquí.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const APP = 'src/app/[locale]'
const RE_LEE_CENTRO = /\b(requireContextoCentro|getEstadoCentro)\s*\(/
const RE_MONTA_AVISO = /<AvisoSuperusuario\b/g

const SIN_AVISO: Record<string, string> = {
  'src/app/[locale]/elegir-centro/page.tsx': 'el selector: todavía no estás dentro de un centro',
  'src/app/[locale]/select-role/page.tsx':
    'reparte por rol y redirige al panel, que ya lleva el aviso (el superusuario solo es admin)',
}

function ficheros(dir: string): string[] {
  const res: string[] = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__') continue
      res.push(...ficheros(abs))
    } else if (nombre === 'page.tsx' || nombre === 'layout.tsx') {
      res.push(path.relative(RAIZ, abs).split(path.sep).join('/'))
    }
  }
  return res
}

const codigo = (rel: string) => sinComentarios(readFileSync(path.join(RAIZ, rel), 'utf8'))

/** Los layouts de `rel` hacia arriba, hasta `src/app/[locale]`, incluido el de su carpeta. */
function layoutsDe(rel: string): string[] {
  const res: string[] = []
  let dir = path.posix.dirname(rel)
  while (dir.startsWith(APP)) {
    const layout = `${dir}/layout.tsx`
    if (existsSync(path.join(RAIZ, layout))) res.push(layout)
    dir = path.posix.dirname(dir)
  }
  return res
}

describe('el aviso de superusuario cubre todo lo que está dentro de un centro', () => {
  const todos = ficheros(path.join(RAIZ, APP))
  const leenCentro = todos.filter((rel) => RE_LEE_CENTRO.test(codigo(rel)))
  const conAviso = todos.filter(
    (rel) => rel.endsWith('/layout.tsx') && (codigo(rel).match(RE_MONTA_AVISO) ?? []).length === 1
  )

  it('premisa: el censo ve las páginas que leen el centro y los layouts con el aviso', () => {
    // Recuento impreso, también cuando pasa.
    console.info(
      `aviso-superusuario: ${leenCentro.length} páginas/layouts leen el centro activo; ` +
        `${conAviso.length} layouts montan el aviso: ${conAviso.join(', ')}`
    )
    expect(leenCentro.length).toBeGreaterThan(40)
    expect(conAviso).toEqual(
      expect.arrayContaining([
        'src/app/[locale]/admin/layout.tsx',
        'src/app/[locale]/teacher/layout.tsx',
        'src/app/[locale]/family/layout.tsx',
        'src/app/[locale]/agenda/layout.tsx',
        'src/app/[locale]/messages/layout.tsx',
        'src/app/[locale]/reminders/layout.tsx',
        'src/app/[locale]/alta/layout.tsx',
      ])
    )
  })

  it('cada página o layout que lee el centro queda debajo de un layout con el aviso', () => {
    const sinCubrir = leenCentro.filter(
      (rel) => !Object.hasOwn(SIN_AVISO, rel) && !layoutsDe(rel).some((l) => conAviso.includes(l))
    )
    expect(sinCubrir).toEqual([])
  })

  it('la lista de excepciones no tiene entradas muertas', () => {
    for (const rel of Object.keys(SIN_AVISO)) expect(leenCentro).toContain(rel)
  })
})
