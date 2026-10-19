#!/usr/bin/env node
// Guard de multicentro (como `check-club-activo` de MisterFC, que cazó su #755).
//
// `roles_usuario` se toca SOLO en `src/features/centros/contexto/`: ahí viven, con nombre y con su
// motivo, la lectura del centro del usuario actual, las que miran a otro usuario o a un centro
// explícito, y las escrituras de la invitación. Este guard falla si fuera de ahí:
//   A. aparece cualquier `.from('roles_usuario')` (lectura o escritura);
//   B. se nombra `getCentroActualId` o `getRolEnCentro` (borradas en el PR5), también en un
//      comentario.
// No hay lista de excepciones (se quitó en el PR6): una lectura nueva va al módulo como función
// con nombre, o no entra.
//
// Para la regla A los comentarios se quitan antes de buscar: un nombre en un comentario no es una
// lectura.
// Uso: `node scripts/check-centro-activo.mjs` (sale con 1 si hay algo).

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * Revisa el árbol `src/` bajo `raiz`. Devuelve los problemas y el recuento (se imprime siempre,
 * también cuando pasa). No recibe ninguna lista: no hay excepciones que pasarle.
 *
 * @param {string} raiz
 */
export function revisar(raiz) {
  const problemas = []
  const lecturas = new Map()
  const usanDeprecadas = new Map()
  let ficherosRevisados = 0
  let usosEnElModulo = 0

  for (const rel of ficheros(path.join(raiz, 'src'), raiz)) {
    const texto = readFileSync(path.join(raiz, rel), 'utf8')
    const n = (sinComentarios(texto).match(RE_ROLES) ?? []).length
    // Dentro del módulo se cuenta, no se prohíbe: es el control de que el patrón sigue cazando.
    if (rel.startsWith(MODULO_CONTEXTO)) {
      usosEnElModulo += n
      continue
    }
    ficherosRevisados++
    if (n > 0) lecturas.set(rel, n)
    // B va sobre el texto entero: tampoco vale nombrarlas en un comentario.
    const usos = (texto.match(RE_DEPRECADAS) ?? []).length
    if (usos > 0) usanDeprecadas.set(rel, usos)
  }

  // A. roles_usuario: ninguna lectura ni escritura fuera del módulo de contexto.
  for (const [rel, hay] of lecturas) {
    problemas.push(
      `${rel}: toca roles_usuario ${hay} vez/veces fuera de features/centros/contexto/. ` +
        'El centro del usuario actual sale de requireContextoCentro / contextoEnCentro; una ' +
        'lectura que mire a otro usuario va al módulo como función con nombre (roles-de-otros.ts).'
    )
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
    ficherosRevisados,
    usosEnElModulo,
    lecturasRoles: [...lecturas.values()].reduce((a, b) => a + b, 0),
    usosDeprecadas: [...usanDeprecadas.values()].reduce((a, b) => a + b, 0),
  }
  return { problemas, recuento }
}

const esCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (esCli) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { problemas, recuento } = revisar(raiz)
  // Los dos ceros: «0 fuera» solo vale si el guard ha mirado ficheros y su patrón caza los usos de
  // dentro del módulo. Un recorrido vacío o un patrón roto pasarían en verde sin medir nada.
  if (recuento.ficherosRevisados === 0 || recuento.usosEnElModulo === 0) {
    problemas.push(
      `el guard no ha medido nada: ${recuento.ficherosRevisados} ficheros revisados y ` +
        `${recuento.usosEnElModulo} usos de roles_usuario dentro del módulo de contexto.`
    )
  }
  const linea =
    `check-centro-activo: ${recuento.ficherosRevisados} ficheros revisados, ` +
    `${recuento.lecturasRoles} usos de roles_usuario fuera del contexto ` +
    `(${recuento.usosEnElModulo} dentro), ` +
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
