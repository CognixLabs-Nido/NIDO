#!/usr/bin/env node
// Codemod de la frontera de las acciones (censo C, decisión de Jose del 2026-11-25). Para cada acción de la
// lista (`fichero#nombre`, la salida `accionesQueLanzan` del escáner de cadena), envuelve el cuerpo entero
// en `try { … } catch (e) { return falloDeLectura(e) }` y añade el import.
//
// AUTOCOMPROBACIÓN, fichero a fichero: quitando exactamente lo insertado (por posición) el texto vuelve a
// ser el original byte a byte; y cada acción tratada tiene que ser una función con cuerpo de bloque y un
// tipo de retorno escrito. Si algo no cuadra, ese fichero no se escribe y el codemod sale con error.
// (Lo de dentro lo deja tal cual: prettier lo indenta después.)
//
// Uso: node scripts/codemods/frontera-acciones.cjs <lista.json> [--escribir]
const fs = require('fs')
const ts = require('typescript')

const [listaPath, ...resto] = process.argv.slice(2)
const ESCRIBIR = resto.includes('--escribir')
const lista = JSON.parse(fs.readFileSync(listaPath, 'utf8'))
const porFichero = new Map()
for (const e of lista) {
  const [f, n] = e.split('#')
  if (!porFichero.has(f)) porFichero.set(f, new Set())
  porFichero.get(f).add(n)
}
const IMPORT = "import { falloDeLectura } from '@/shared/lib/frontera-lectura'\n"
let tratadas = 0
let fallos = 0
const apartadas = []
for (const [f, nombres] of porFichero) {
  const original = fs.readFileSync(f, 'utf8')
  const sf = ts.createSourceFile(f, original, ts.ScriptTarget.Latest, true)
  const inserciones = [] // { pos, texto }
  const vistas = new Set()
  const visitar = (n) => {
    let fn = null
    let nombre = null
    if (ts.isFunctionDeclaration(n) && n.name && nombres.has(n.name.text)) {
      fn = n
      nombre = n.name.text
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      nombres.has(n.name.text) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      fn = n.initializer
      nombre = n.name.text
    }
    if (fn) {
      vistas.add(nombre)
      if (!fn.body || !ts.isBlock(fn.body) || !fn.type) {
        apartadas.push(`${f}#${nombre}: sin cuerpo de bloque o sin tipo de retorno`)
        return
      }
      const cuerpo = fn.body
      if (/catch \(e\) \{\s*return falloDeLectura\(e\)/.test(cuerpo.getText())) {
        apartadas.push(`${f}#${nombre}: ya tiene la frontera`)
        return
      }
      inserciones.push({ pos: cuerpo.getStart() + 1, texto: '\n  try {' })
      inserciones.push({
        pos: cuerpo.getEnd() - 1,
        texto: '\n  } catch (e) {\n    return falloDeLectura(e)\n  }\n',
      })
      tratadas++
      return
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  for (const n of nombres) if (!vistas.has(n)) apartadas.push(`${f}#${n}: no encontrada`)
  if (inserciones.length === 0) continue
  // el import, después del último import
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s))
  const yaImporta = original.includes("from '@/shared/lib/frontera-lectura'")
  if (!yaImporta)
    inserciones.push({
      pos: imports.length ? imports[imports.length - 1].getEnd() + 1 : 0,
      texto: IMPORT,
    })
  inserciones.sort((a, b) => b.pos - a.pos)
  let nuevo = original
  for (const i of inserciones) nuevo = nuevo.slice(0, i.pos) + i.texto + nuevo.slice(i.pos)
  // Control de la autocomprobación: CODEMOD_ROMPER=1 cambia además algo que no se insertó (un espacio
  // en el original), y la comprobación tiene que pararlo (exit 2).
  if (process.env.CODEMOD_ROMPER === '1') nuevo = nuevo.replace('{', '{ ')
  // autocomprobación: quitar lo insertado por posición (en orden ascendente, corrigiendo desplazamientos)
  let quitado = nuevo
  const asc = [...inserciones].sort((a, b) => a.pos - b.pos)
  let desp = 0
  for (const i of asc) {
    const p = i.pos + desp
    if (quitado.slice(p, p + i.texto.length) !== i.texto) {
      fallos++
      console.error(`AUTOCOMPROBACIÓN: ${f} en ${i.pos}`)
      break
    }
    quitado = quitado.slice(0, p) + quitado.slice(p + i.texto.length)
  }
  if (quitado !== original) {
    fallos++
    console.error(`AUTOCOMPROBACIÓN: ${f} no vuelve al original`)
    continue
  }
  if (ESCRIBIR) fs.writeFileSync(f, nuevo)
}
console.log(
  `tratadas ${tratadas} · apartadas ${apartadas.length} · fallos de autocomprobación ${fallos}`
)
for (const a of apartadas) console.log('  APARTADA ' + a)
if (fallos) process.exit(2)
