#!/usr/bin/env node
// Guard de multicentro, segunda mitad: las LECTURAS acotadas al centro.
//
// La RLS de una tabla de centro dice QUIÉN ve una fila, no DE QUÉ CENTRO es la página: al
// superusuario (admin de todos los centros) y a quien tiene rol en dos centros les devuelve las
// filas de todos. Una consulta que confía en que «la RLS acota al centro» mezcla centros en
// cuanto existe el segundo (Fase 5: lo crea el panel de plataforma). `check-centro-activo` no lo
// ve: vigila `roles_usuario` y la cookie, no las demás tablas.
//
// Regla: toda cadena `.from('<tabla de centro>')` que lee, actualiza o borra filtra (`eq`, `in`
// o `match`) por una columna que fija el centro:
//   - `centro_id`, también la de un embebido (`nino.centro_id`, `aulas.centro_id`);
//   - `id`;
//   - una FK del catálogo de `src/types/database.ts` que no apunta a `usuarios` (`nino_id`,
//     `aula_id`, `curso_academico_id`…): la fila de destino es de un solo centro. Las FK a
//     `usuarios` no fijan nada: una persona tiene filas en todos sus centros.
// Si no, lleva justo encima `// entre-centros: <motivo>` (en su sentencia o en su elemento de un
// array, p. ej. de `Promise.all`): la lectura cruza centros A PROPÓSITO y dice por qué. Una marca
// sobre una cadena que sí filtra es un error: el motivo ya no es verdad.
// Los INSERT y UPSERT llevan el centro en la fila y no entran. Tampoco los `.from()` de Storage.
// Una tabla de centro es cualquiera del catálogo salvo las de `SIN_CENTRO`, cada una con su
// motivo: una tabla nueva entra vigilada.
// El filtro se tiene que ver EN LA CADENA: uno añadido después a una variable o hecho en JS no
// cuenta (no se puede comprobar).
// Uso: `node scripts/check-lecturas-por-centro.mjs` (sale con 1 si hay algo).

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const MARCA = /\/\/\s*entre-centros:\s*(\S.{9,})/
/** Tablas que no son de un centro, y por qué. */
export const SIN_CENTRO = {
  auth_attempts: 'intentos de acceso por IP, antes de saber el usuario',
  platform_admins: 'la plataforma, por encima de los centros',
  preferencias_usuario: 'de la persona, valen en todos sus centros',
  push_subscriptions: 'del dispositivo de la persona',
}
const FILTROS = new Set(['eq', 'in', 'match'])
const ESCRIBEN_FILA = new Set(['insert', 'upsert'])
const OPERACIONES = new Set(['select', 'insert', 'update', 'delete', 'upsert'])

/** Del catálogo de tipos: tablas y, por tabla, las columnas que fijan el centro. */
export function leerCatalogo(textoDatabase) {
  const tablas = new Map()
  // Las tablas del esquema `public` (antes va `graphql_public`, con sus `Tables` vacías).
  const esquema = textoDatabase.indexOf('\n  public: {')
  const inicio = textoDatabase.indexOf('\n    Tables: {', esquema)
  const fin = textoDatabase.indexOf('\n    Views: {', inicio)
  const bloque = textoDatabase.slice(inicio, fin)
  // Un bloque por tabla, de su cabecera a la siguiente: `Relationships` puede ser `[]` en una
  // línea, y una FK puede ser compuesta (`matriculas` → `aulas_curso (aula_id, curso_academico_id)`).
  const cabeceras = [...bloque.matchAll(/\n {6}(\w+): \{\n {8}Row: \{/g)]
  cabeceras.forEach((c, i) => {
    const texto = bloque.slice(c.index, cabeceras[i + 1]?.index ?? bloque.length)
    const row = texto.slice(texto.indexOf('Row: {'), texto.indexOf('\n        }'))
    const columnas = new Set([...row.matchAll(/^ {10}(\w+)\??:/gm)].map((x) => x[1]))
    const fijan = new Set(['id'])
    if (columnas.has('centro_id')) fijan.add('centro_id')
    for (const r of texto.matchAll(/columns: \[([^\]]*)\][\s\S]*?referencedRelation: "(\w+)"/g)) {
      if (r[2] === 'usuarios') continue
      for (const col of r[1].matchAll(/"(\w+)"/g)) fijan.add(col[1])
    }
    tablas.set(c[1], { columnas, fijan })
  })
  return tablas
}

function ficheros(dir, raiz) {
  const res = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    const rel = path.relative(raiz, abs).split(path.sep).join('/')
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules' || rel === 'src/test') continue
      res.push(...ficheros(abs, raiz))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|d)\.(ts|tsx)$/.test(nombre)) {
      res.push(rel)
    }
  }
  return res
}

/** Columna de un filtro: el último tramo (`nino.centro_id` → `centro_id`). */
function columnaDe(arg) {
  if (!arg || !ts.isStringLiteralLike(arg)) return null
  return arg.text.split('.').pop()
}

/** Las marcas `entre-centros` encima de la cadena: en su elemento de array o en su sentencia. */
function marcaDe(nodo, texto) {
  let n = nodo
  while (n.parent) {
    const p = n.parent
    const tope = ts.isArrayLiteralExpression(p) || ts.isBlock(p) || ts.isSourceFile(p)
    if (tope) {
      // Los comentarios de encima, juntos: la marca sigue en las líneas `//` de debajo.
      const comentarios = (ts.getLeadingCommentRanges(texto, n.getFullStart()) ?? [])
        .map((c) => texto.slice(c.pos, c.end))
        .join('\n')
      const desde = comentarios.search(MARCA)
      if (desde < 0) return null
      return comentarios
        .slice(desde)
        .split('\n')
        .map((l) => l.replace(/^\s*\/\/\s*/, ''))
        .join(' ')
        .replace(/^entre-centros:\s*/, '')
        .trim()
    }
    n = p
  }
  return null
}

/**
 * Revisa el árbol `src/` bajo `raiz`. Devuelve los problemas y el recuento (se imprime siempre,
 * también cuando pasa).
 *
 * @param {string} raiz
 */
export function revisar(raiz) {
  const problemas = []
  const tablas = leerCatalogo(readFileSync(path.join(raiz, 'src/types/database.ts'), 'utf8'))
  for (const t of Object.keys(SIN_CENTRO)) {
    if (!tablas.has(t)) problemas.push(`SIN_CENTRO nombra ${t}, que no está en el catálogo.`)
    else if (tablas.get(t).columnas.has('centro_id'))
      problemas.push(`SIN_CENTRO nombra ${t}, que tiene centro_id: es de un centro.`)
  }
  const recuento = {
    ficherosRevisados: 0,
    cadenas: 0,
    acotadas: 0,
    escrituras: 0,
    sinCentro: 0,
    marcadas: 0,
  }
  const marcas = []

  for (const rel of ficheros(path.join(raiz, 'src'), raiz)) {
    recuento.ficherosRevisados++
    const texto = readFileSync(path.join(raiz, rel), 'utf8')
    const sf = ts.createSourceFile(rel, texto, ts.ScriptTarget.Latest, true)
    const visitar = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'from'
      ) {
        const receptor = n.expression.expression
        const esStorage =
          ts.isPropertyAccessExpression(receptor) && receptor.name.text === 'storage'
        if (!esStorage) revisarCadena(n)
      }
      ts.forEachChild(n, visitar)
    }
    const revisarCadena = (n) => {
      const linea = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
      const donde = `${rel}:${linea}`
      const metodos = []
      let cur = n
      while (
        cur.parent &&
        ts.isPropertyAccessExpression(cur.parent) &&
        cur.parent.parent &&
        ts.isCallExpression(cur.parent.parent)
      ) {
        metodos.push({ nombre: cur.parent.name.text, args: cur.parent.parent.arguments })
        cur = cur.parent.parent
      }
      // Una consulta de Supabase sigue con su operación; `Buffer.from(...)` o `Array.from(...)`, no.
      if (!OPERACIONES.has(metodos[0]?.nombre)) return
      const arg = n.arguments[0]
      if (!arg || !ts.isStringLiteralLike(arg)) {
        // Tabla variable (`marcarEventoErroneo`, una de las de la agenda): solo vale por `id`,
        // que fija el centro en cualquier tabla.
        recuento.cadenas++
        const porId = metodos.some((m) => FILTROS.has(m.nombre) && columnaDe(m.args[0]) === 'id')
        if (porId) recuento.acotadas++
        else problemas.push(`${donde}: .from() con tabla variable y sin filtro por id.`)
        return
      }
      const tabla = arg.text
      const info = tablas.get(tabla)
      if (!info) {
        problemas.push(`${donde}: .from('${tabla}') no está en el catálogo de database.ts.`)
        return
      }
      recuento.cadenas++
      const marca = marcaDe(n, texto)
      if (marca) marcas.push({ donde, tabla, motivo: marca })
      if (metodos.some((m) => ESCRIBEN_FILA.has(m.nombre))) {
        recuento.escrituras++
        if (marca) problemas.push(`${donde}: marca entre-centros sobre un INSERT/UPSERT: sobra.`)
        return
      }
      if (Object.hasOwn(SIN_CENTRO, tabla)) {
        recuento.sinCentro++
        if (marca)
          problemas.push(`${donde}: marca entre-centros sobre ${tabla}, que no es de centro.`)
        return
      }
      const acotada = metodos.some((m) => {
        if (!FILTROS.has(m.nombre)) return false
        if (m.nombre === 'match') {
          const obj = m.args[0]
          return (
            obj &&
            ts.isObjectLiteralExpression(obj) &&
            obj.properties.some(
              (p) => p.name && info.fijan.has(p.name.getText(sf).replace(/['"]/g, ''))
            )
          )
        }
        const col = columnaDe(m.args[0])
        if (!col) return false
        return col === 'centro_id' || info.fijan.has(col)
      })
      if (acotada) {
        recuento.acotadas++
        if (marca) {
          problemas.push(
            `${donde}: marca entre-centros sobre una consulta que ya filtra por centro: el ` +
              'motivo ya no es verdad; quita la marca.'
          )
        }
        return
      }
      if (marca) {
        recuento.marcadas++
        return
      }
      problemas.push(
        `${donde}: .from('${tabla}') no filtra por centro_id ni por una clave que fije el centro. ` +
          'La RLS dice quién ve la fila, no de qué centro es la página: con dos centros mezcla ' +
          "los de todos. Filtra por el centro de la página (p. ej. .eq('centro_id', centroId) o " +
          "un embebido !inner con .eq('nino.centro_id', centroId)); si cruza centros a " +
          'propósito, ponle encima `// entre-centros: <motivo>`.'
      )
    }
    visitar(sf)
  }
  return { problemas, recuento, marcas }
}

const esCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (esCli) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { problemas, recuento, marcas } = revisar(raiz)
  // Los dos ceros: «0 problemas» solo vale si ha visto cadenas, acotadas y marcadas.
  if (recuento.cadenas === 0 || recuento.acotadas === 0 || recuento.marcadas === 0) {
    problemas.push(
      `el guard no ha medido nada: ${recuento.cadenas} cadenas, ${recuento.acotadas} acotadas, ` +
        `${recuento.marcadas} marcadas.`
    )
  }
  const linea =
    `check-lecturas-por-centro: ${recuento.ficherosRevisados} ficheros, ${recuento.cadenas} ` +
    `cadenas .from(): ${recuento.acotadas} acotadas al centro, ${recuento.marcadas} entre ` +
    `centros con su motivo, ${recuento.escrituras} INSERT/UPSERT, ${recuento.sinCentro} de ` +
    `tablas sin centro; ${problemas.length} problemas.`
  process.stdout.write(`${linea}\n`)
  for (const m of marcas) {
    process.stdout.write(`  entre-centros ${m.donde} (${m.tabla}): ${m.motivo}\n`)
  }
  // En la CI, también en el resumen del job.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Guard lecturas por centro\n\n${linea}\n\n` +
        (problemas.length > 0 ? problemas.map((p) => `- ✗ ${p}`).join('\n') + '\n' : '')
    )
  }
  for (const p of problemas) console.error(`  ✗ ${p}`)
  process.exit(problemas.length > 0 ? 1 : 0)
}
