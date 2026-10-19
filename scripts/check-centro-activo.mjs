#!/usr/bin/env node
// Guard de multicentro (como `check-club-activo` de MisterFC, que cazó su #755).
//
// El centro del usuario actual se saca SOLO en `src/features/centros/contexto/`. Este guard falla
// si fuera de ahí:
//   A. se lee `roles_usuario` (cualquier `.from('roles_usuario')`) más o menos veces de las que
//      dice `LECTURAS_PERMITIDAS`: lecturas que miran a OTRO usuario, cada una con su motivo. Un
//      fichero nuevo, o una lectura nueva en uno que ya estaba, es rojo; una entrada que sobra,
//      también.
//   B. se nombra `getCentroActualId` o `getRolEnCentro`, en código o en un comentario. Se borraron
//      al cerrar la Fase 1 (PR5) y no hay lista que las admita: cualquier mención es rojo.
//
// Para la regla A los comentarios se quitan antes de buscar: un nombre en un comentario no es una
// lectura.
// Uso: `node scripts/check-centro-activo.mjs` (sale con 1 si hay algo).

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { LECTURAS_PERMITIDAS } from './check-centro-activo.lista.mjs'

const MODULO_CONTEXTO = 'src/features/centros/contexto/'
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
 * }} ListaCentroActivo
 */

/**
 * Revisa el árbol `src/` bajo `raiz` contra la lista. Devuelve los problemas y el recuento
 * (se imprime siempre, también cuando pasa).
 *
 * @param {string} raiz
 * @param {ListaCentroActivo} [lista]
 */
export function revisar(raiz, lista = { LECTURAS_PERMITIDAS }) {
  const problemas = []
  const lecturas = new Map()
  const usanDeprecadas = new Map()

  for (const rel of ficheros(path.join(raiz, 'src'), raiz)) {
    if (rel.startsWith(MODULO_CONTEXTO)) continue
    const texto = readFileSync(path.join(raiz, rel), 'utf8')
    const n = (sinComentarios(texto).match(RE_ROLES) ?? []).length
    if (n > 0) lecturas.set(rel, n)
    // B va sobre el texto entero: tampoco vale nombrarlas en un comentario.
    const usos = (texto.match(RE_DEPRECADAS) ?? []).length
    if (usos > 0) usanDeprecadas.set(rel, usos)
  }

  // A. Lecturas de roles_usuario: las del fichero tienen que ser exactamente las de la lista.
  for (const rel of new Set([...lecturas.keys(), ...Object.keys(lista.LECTURAS_PERMITIDAS)])) {
    const hay = lecturas.get(rel) ?? 0
    const esperadas = lista.LECTURAS_PERMITIDAS[rel]?.n ?? 0
    if (hay > esperadas) {
      problemas.push(
        `${rel}: ${hay} lectura(s) de roles_usuario y la lista admite ${esperadas}. ` +
          'El centro del usuario actual se saca con requireContextoCentro / contextoEnCentro; ' +
          'una lectura que mira a OTRO usuario va a LECTURAS_PERMITIDAS con su motivo.'
      )
    } else if (hay < esperadas) {
      problemas.push(
        `${rel}: la lista admite ${esperadas} lectura(s) de roles_usuario y hay ${hay}. ` +
          'Bórrala de la lista (solo puede bajar).'
      )
    }
  }

  // B. getCentroActualId / getRolEnCentro: borradas en el PR5. Ninguna mención, sin excepciones.
  for (const [rel, hay] of usanDeprecadas) {
    problemas.push(
      `${rel}: nombra getCentroActualId/getRolEnCentro ${hay} vez/veces. Se borraron al cerrar ` +
        'la Fase 1: usa requireContextoCentro (páginas) o el centro explícito de la página o del ' +
        'registro (acciones).'
    )
  }

  const recuento = {
    lecturasRoles: [...lecturas.values()].reduce((a, b) => a + b, 0),
    ficherosConLecturas: lecturas.size,
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
    `en ${recuento.ficherosConLecturas} ficheros (todas en LECTURAS_PERMITIDAS), ` +
    `${recuento.usosDeprecadas} menciones de getCentroActualId/getRolEnCentro.`
  process.stdout.write(`${linea}\n`)
  // En la CI, también en el resumen del job.
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
