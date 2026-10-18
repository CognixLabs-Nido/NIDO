#!/usr/bin/env node
// Guard de multicentro · Fase 1 (como `check-club-activo` de MisterFC, que cazó su #755).
//
// El centro del usuario actual se saca SOLO en `src/features/centros/contexto/`. Este guard falla
// si fuera de ahí:
//   A. se lee `roles_usuario` (cualquier `.from('roles_usuario')`) más veces de las que permite la
//      lista (`LECTURAS_PERMITIDAS`: miran a otro usuario; `LECTURAS_PENDIENTES`: por migrar);
//   B. se nombra `getCentroActualId` / `getRolEnCentro` (deprecadas) más veces de las que admite
//      `PENDIENTES_GET_CENTRO` para ese fichero (import + llamadas). Un fichero nuevo, o una
//      llamada nueva en uno que ya estaba, es rojo.
// Y falla también si la lista sobra (una entrada que ya no hace falta, o un número más alto que
// los usos reales): así la lista solo baja y cada PR de la sustitución tiene que bajarla
// exactamente en lo que migra. Con la lista vacía (PR5) cualquier uso es rojo.
//
// Los comentarios se quitan antes de buscar: un nombre en un comentario no es un uso.
// Uso: `node scripts/check-centro-activo.mjs` (sale con 1 si hay algo).

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LECTURAS_PENDIENTES,
  LECTURAS_PERMITIDAS,
  PENDIENTES_GET_CENTRO,
} from './check-centro-activo.lista.mjs'

const MODULO_CONTEXTO = 'src/features/centros/contexto/'
const DEFINE_DEPRECADAS = 'src/features/centros/queries/get-centro-actual.ts'
const RE_ROLES = /\.from\(\s*['"`]roles_usuario['"`]\s*\)/g
const RE_DEPRECADAS = /\b(getCentroActualId|getRolEnCentro)\b/g

/** Quita comentarios `//` y `/* *\/` respetando cadenas y plantillas. */
export function sinComentarios(src) {
  let out = ''
  let i = 0
  let enCadena = null
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (enCadena) {
      out += c
      if (c === '\\') {
        out += d ?? ''
        i += 2
        continue
      }
      if (c === enCadena) enCadena = null
      i++
      continue
    }
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') enCadena = c
    out += c
    i++
  }
  return out
}

function ficheros(dir, raiz) {
  const res = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    const rel = path.relative(raiz, abs).split(path.sep).join('/')
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules' || rel === 'src/test') continue
      res.push(...ficheros(abs, raiz))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      res.push(rel)
    }
  }
  return res
}

/**
 * @typedef {{
 *   LECTURAS_PERMITIDAS: Record<string, { n: number; motivo: string }>
 *   LECTURAS_PENDIENTES: Record<string, number>
 *   PENDIENTES_GET_CENTRO: Record<string, number>
 * }} ListaCentroActivo
 */

/**
 * Revisa el árbol `src/` bajo `raiz` contra la lista. Devuelve los problemas y el recuento
 * (se imprime siempre, también cuando pasa).
 *
 * @param {string} raiz
 * @param {ListaCentroActivo} [lista]
 */
export function revisar(
  raiz,
  lista = { LECTURAS_PERMITIDAS, LECTURAS_PENDIENTES, PENDIENTES_GET_CENTRO }
) {
  const problemas = []
  const lecturas = new Map()
  const usanDeprecadas = new Map()

  for (const rel of ficheros(path.join(raiz, 'src'), raiz)) {
    if (rel.startsWith(MODULO_CONTEXTO)) continue
    const codigo = sinComentarios(readFileSync(path.join(raiz, rel), 'utf8'))
    const n = (codigo.match(RE_ROLES) ?? []).length
    if (n > 0) lecturas.set(rel, n)
    const usos = rel === DEFINE_DEPRECADAS ? 0 : (codigo.match(RE_DEPRECADAS) ?? []).length
    if (usos > 0) usanDeprecadas.set(rel, usos)
  }

  // A. Lecturas de roles_usuario: las del fichero tienen que ser exactamente las de la lista.
  const conLista = new Set([
    ...Object.keys(lista.LECTURAS_PERMITIDAS),
    ...Object.keys(lista.LECTURAS_PENDIENTES),
  ])
  for (const rel of new Set([...lecturas.keys(), ...conLista])) {
    const hay = lecturas.get(rel) ?? 0
    const permitidas = lista.LECTURAS_PERMITIDAS[rel]?.n ?? 0
    const pendientes = lista.LECTURAS_PENDIENTES[rel] ?? 0
    const esperadas = permitidas + pendientes
    if (hay > esperadas) {
      problemas.push(
        `${rel}: ${hay} lectura(s) de roles_usuario y la lista admite ${esperadas}. ` +
          'El centro del usuario actual se saca con requireContextoCentro / contextoEnCentro.'
      )
    } else if (hay < esperadas) {
      problemas.push(
        `${rel}: la lista admite ${esperadas} lectura(s) de roles_usuario y hay ${hay}. ` +
          'Bórrala de la lista (solo puede bajar).'
      )
    }
  }

  // B. Usos de las funciones deprecadas: los del fichero tienen que ser exactamente los de la lista.
  for (const rel of new Set([
    ...usanDeprecadas.keys(),
    ...Object.keys(lista.PENDIENTES_GET_CENTRO),
  ])) {
    const hay = usanDeprecadas.get(rel) ?? 0
    const admite = lista.PENDIENTES_GET_CENTRO[rel] ?? 0
    if (hay > admite) {
      problemas.push(
        `${rel}: nombra getCentroActualId/getRolEnCentro (deprecadas) ${hay} vez/veces y la ` +
          `lista admite ${admite}. ` +
          'Usa requireContextoCentro (páginas) o contextoEnCentro (acciones con centro explícito).'
      )
    } else if (hay < admite) {
      problemas.push(
        `${rel}: PENDIENTES_GET_CENTRO admite ${admite} uso(s) de las deprecadas y hay ${hay}. ` +
          (hay === 0 ? 'Bórralo de la lista.' : `Bájalo a ${hay}.`)
      )
    }
  }

  const recuento = {
    lecturasRoles: [...lecturas.values()].reduce((a, b) => a + b, 0),
    lecturasPendientes: Object.values(lista.LECTURAS_PENDIENTES).reduce((a, b) => a + b, 0),
    ficherosConDeprecadas: usanDeprecadas.size,
    usosDeprecadas: [...usanDeprecadas.values()].reduce((a, b) => a + b, 0),
  }
  return { problemas, recuento }
}

const esCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (esCli) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { problemas, recuento } = revisar(raiz)
  const linea =
    `check-centro-activo: ${recuento.lecturasRoles} lecturas de roles_usuario fuera del contexto ` +
    `(${recuento.lecturasPendientes} por migrar), ${recuento.ficherosConDeprecadas} ficheros con ` +
    `getCentroActualId/getRolEnCentro (${recuento.usosDeprecadas} usos).`
  process.stdout.write(`${linea}\n`)
  // En la CI, también en el resumen del job: lo que queda por migrar se ve en cada PR.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Guard centro activo\n\n${linea}\n\n` +
        (problemas.length > 0 ? problemas.map((p) => `- ✗ ${p}`).join('\n') + '\n' : '')
    )
  }
  for (const p of problemas) console.error(`  ✗ ${p}`)
  process.exit(problemas.length > 0 ? 1 : 0)
}
