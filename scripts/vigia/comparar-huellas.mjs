#!/usr/bin/env node
// Compara dos huellas de catálogo (scripts/vigia/huella.sql) y dice qué objetos difieren.
//
// Uso: node scripts/vigia/comparar-huellas.mjs <produccion.tsv> <efimera.tsv> [conocidas.tsv]
//
// Cada línea de una huella es «tipo<TAB>objeto<TAB>md5». Imprime SOLO tipo y objeto (nombres que ya
// están en el repo), nunca el md5 ni la definición: el log del job es público.
//
// Las diferencias conocidas (fichero opcional, «tipo<TAB>objeto<TAB>motivo», `#` comenta) no
// cuentan como deriva; si una ya no aparece, se avisa para quitarla de la lista.
//
// Sale con 1 si hay alguna diferencia no conocida, con 2 si falta un fichero o una huella está vacía.
import fs from 'node:fs'

function leerHuella(ruta) {
  const mapa = new Map()
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    if (!linea.trim()) continue
    const [tipo, objeto, h] = linea.split('\t')
    mapa.set(`${tipo}\t${objeto}`, h)
  }
  return mapa
}

function leerConocidas(ruta) {
  const conocidas = new Set()
  if (!ruta) return conocidas
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    if (!linea.trim() || linea.startsWith('#')) continue
    const [tipo, objeto] = linea.split('\t')
    conocidas.add(`${tipo}\t${objeto}`)
  }
  return conocidas
}

const [rutaProd, rutaEfimera, rutaConocidas] = process.argv.slice(2)
if (!rutaProd || !rutaEfimera) {
  console.error('Uso: comparar-huellas.mjs <produccion.tsv> <efimera.tsv> [conocidas.tsv]')
  process.exit(2)
}
const prod = leerHuella(rutaProd)
const efimera = leerHuella(rutaEfimera)
const conocidas = leerConocidas(rutaConocidas)
if (prod.size === 0 || efimera.size === 0) {
  console.error(`Huella vacía: producción ${prod.size} filas, efímera ${efimera.size} filas`)
  process.exit(2)
}

const diferencias = []
for (const [clave, h] of prod) {
  if (!efimera.has(clave)) diferencias.push({ clave, como: 'solo en producción' })
  else if (efimera.get(clave) !== h) diferencias.push({ clave, como: 'difiere' })
}
for (const clave of efimera.keys()) {
  if (!prod.has(clave)) diferencias.push({ clave, como: 'solo en el repo (efímera)' })
}
diferencias.sort((a, b) => a.clave.localeCompare(b.clave))

const nuevas = diferencias.filter((d) => !conocidas.has(d.clave))
const vistas = new Set(diferencias.map((d) => d.clave))
const caducadas = [...conocidas].filter((c) => !vistas.has(c))

const fmt = (clave) => clave.replace('\t', ' ')
console.log(`Huellas: producción ${prod.size} filas, efímera ${efimera.size} filas.`)
for (const d of diferencias.filter((d) => conocidas.has(d.clave))) {
  console.log(`  conocida (no cuenta): ${d.como}: ${fmt(d.clave)}`)
}
for (const c of caducadas) {
  console.log(`  AVISO: la diferencia conocida «${fmt(c)}» ya no aparece; quítala de la lista`)
}
if (nuevas.length === 0) {
  console.log('Sin deriva de catálogo.')
  process.exit(0)
}
console.log(`DERIVA DE CATÁLOGO: ${nuevas.length} objetos`)
for (const d of nuevas) console.log(`  ${d.como}: ${fmt(d.clave)}`)
process.exit(1)
