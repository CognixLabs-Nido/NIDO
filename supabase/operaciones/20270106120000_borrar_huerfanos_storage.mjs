#!/usr/bin/env node
// =============================================================================
// OPERACIÓN 20270106120000 · Los 60 ficheros de Storage bajo centros que no existen
//
// Una sola vez, en producción. NO es una migración ni un SQL: es la primera operación que borra
// de Storage, y eso no se puede hacer con SQL. `storage.protect_delete` rechaza el DELETE sobre
// `storage.objects` («Use the Storage API instead»); forzarlo con `storage.allow_delete_query`
// borra la fila y deja el fichero guardado, inalcanzable. Aquí se borra por la API de Storage,
// que borra las dos cosas. Convención y motivo en supabase/operaciones/README.md.
//
// Contexto: 60 PDF de 15 bytes, `{centro}/{niño}/{bucket}.pdf` en dni-tutores, libro-familia y
// mandato-sepa, 3 por cada uno de 20 centros que ya no existen. Los subió
// `src/test/rls/f11g-validacion-purga.rls.test.ts` las noches del 1 al 11 de octubre, cuando la
// suite RLS corría contra producción; su limpieza borraba el centro y no los ficheros. Desde el
// #340 (11-10, 12:06 UTC) la suite solo corre contra la BD local. Diagnóstico completo:
// docs/operations/huerfanos-storage-2026-11.md.
//
// Qué caso: los 60 de la lista HUELLAS, cada uno por el md5 de su ruta completa
// («bucket/nombre»), no por «lo que esté bajo un centro inexistente». Si mañana aparece otro
// fichero sin dueño, la operación FALLA y lo nombra; no lo barre. El repo es público: la lista va
// por md5, como la del vínculo del segundo tutor.
//
// Guardas (cualquiera que falle aborta ANTES de borrar nada):
//   1. los ficheros sin dueño (primera carpeta que no es ningún centro ni ningún usuario) son
//      EXACTAMENTE los de la lista: ni falta uno ni sobra uno;
//   2. recuento exacto: 60, 20 por bucket; cada uno con la forma `{uuid}/{uuid}/{bucket}.pdf`,
//      15 bytes y application/pdf, y su centro y su niño siguen sin existir;
//   3. NINGUNA fila de la base apunta a ninguno: se busca cada id de centro y de niño en todas
//      las columnas de texto, json y uuid de todas las tablas (menos `storage.objects`, que son
//      los propios ficheros). Control positivo en la misma pasada: un centro real tiene que
//      aparecer, o el escaneo no mira nada y se aborta;
//   4. la API dice que existen los 60 antes de borrar: es el control positivo de la comprobación
//      del final.
// Después de borrar, NO se da por bueno el 200 de la API. Se comprueba que los 60 YA NO ESTÁN:
// ninguna fila en `storage.objects`, la API dice que no existen, cada bucket tiene 20 menos, y
// el resto de ficheros sigue idéntico (huella de todas sus filas). Lo que no se puede ver desde
// fuera es la capa de bytes de debajo; el borrado por la API la incluye por contrato, y es lo
// que el borrado por SQL no hace.
//
// El SQL de esta operación es SOLO de lectura: va a la Management API con `read_only: true`.
// Lo único que escribe es la llamada `remove` de Storage, con los 60 nombres y ninguno más.
//
// ENSAYO (por defecto hay que elegir): `node supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs --ensayo`
//   comprueba todas las guardas, imprime los 60 por bucket y por centro y termina con error
//   «ENSAYO OK, nada borrado». No borra nada.
// APLICAR: el mismo comando con `--aplicar`. Desde la raíz del repo, con `.env.local`
//   (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ACCESS_TOKEN).
//
// No es una transacción: si se corta a medias (borrado un bucket y otro no), la guarda 1
// fallará al repetirla, porque faltarán ficheros de la lista. No se reintenta a ciegas: se mira
// qué quedó.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { pathToFileURL } from 'node:url'

/** md5('bucket/nombre') de los 60, del diagnóstico del 2026-11-06. */
export const HUELLAS = Object.freeze([
  '007ae4a32db3f4a94d71df0b4bef5d68',
  '059de5d1ce1f0c5ecaa151522b08b99f',
  '06993184cb6e5e1f72ce62adb4d862e1',
  '0c18087e2b3ea7637f39595464f6f037',
  '0d1fabeb0d516a411c6f60f26d12c9b7',
  '10b3a855e93837057fe546ef3427987c',
  '119202459e171c1e5e9df5166077d5e6',
  '163cf6f9c96074474bad321e908e230d',
  '1948cee2ce8bef46268ae49316d6a5b2',
  '1abba40dfe4b1c11f65da72fd91e8dbc',
  '1cb4791b7d111b3d8a1db02de973c907',
  '2f87f9510798cf77b08f887c624466f7',
  '343e93b293e0b7757e03be2c47de6d13',
  '349bddb0a4ca1f659f1c528fd500204e',
  '370b5c9f5e2de0254b49f74e556aea18',
  '3844106f14dad895886eaa3d105de827',
  '4eb7a8b999f7f2d0e4ccf406629ecb69',
  '57a07ec2463dd9900126d7ccedf03ef6',
  '5d89a4054fe13e9c59760d992881fc18',
  '5eb8a04f5430333f41e9a698d656d184',
  '60db5f46e18c582e9ad3ebf515c4c567',
  '646b59672823add9de59f17572b1fce2',
  '691078d35662b673f646f37317e175d5',
  '729706bdadb7084284b7d4c6de481414',
  '73a69a16624e2db69478ffcc16bdebea',
  '7725b9885ad1db4b5a71d02922739bdf',
  '774c6fe1867d51f1f4af3f0f14618cc6',
  '7d130d1622c3b6a43b85daa044e44f2d',
  '7f1307bd9729039adeefc19583c26ba1',
  '845c18f7331973a794c35aecb381e54a',
  '85ac6cccdb8f7a89473dec3b86bff11e',
  '8fafe7b5ade608485b92f88a9ff4bebb',
  '9747224833a5f36313b9df2c0f51b919',
  '9d903076f44021e94375ae7d7bc9dae8',
  '9f48d35ca6396c829f3b0f0ad63fca22',
  '9f8d61db343f589624255e0d0983c55a',
  'a055367e3a3543745b37027252546273',
  'a1faf2245c0f09b01c6c0279797ba865',
  'a273f049dedcf72fea9b4649ad17f0c8',
  'a6215bacba00759f331d59f70fd97269',
  'a6e2d6a4412c0f4b26f71ec32fde796f',
  'a6fc0b79940477e3da53f808644a9e42',
  'a7c3c9934eb4392c23cfa0e1c6b31bf7',
  'a9cf3bd23a7e5be66147ca90f3b74b59',
  'ab5a9d1312c651f54ad3bd1703fdbf96',
  'b606090cbfa6e6e58dfe9a7f7020a525',
  'b9047ae99648e2d30576dcc19da64065',
  'bc5267c396e76719e47e36d632966e4b',
  'bce66b43021b635e51ce5e7d0829c222',
  'c71790a278b750e17403bee4a5c5fc7d',
  'd015d367d6d5308cc8396932c4c6ba93',
  'd12a6afe95ad2b657c21063a6cd8b035',
  'd69d46e18807ebc02db75d6eb288e8cc',
  'ded32094fda6e325fd20d3d3fc604274',
  'e0f3ec7471ad05b3922175447bde19a3',
  'e19846109927c811df952c16b826e7e5',
  'e7c5faa1fa63316e015ec08676c2fa39',
  'e864eefc00182163dfa54f31f8caf73a',
  'e94552f860651e7126a06f6e981c86ae',
  'fa173f0a9f0f646574f19a45056f3ebf',
])

/** Recuentos aprobados (diagnóstico del 2026-11-06). Si algo da otro número, no se borra nada. */
export const ESPERADO = Object.freeze({
  total: 60,
  porBucket: Object.freeze({ 'dni-tutores': 20, 'libro-familia': 20, 'mandato-sepa': 20 }),
  tamano: 15,
  mime: 'application/pdf',
})

/** CEI Ejemplo, el centro real de producción: el control positivo del escaneo de referencias. */
export const CENTRO_CONTROL = '33c79b50-13b5-4962-b849-d88dd6a21366'

const RE_MD5 = /^[0-9a-f]{32}$/
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Un fichero no tiene dueño si su primera carpeta no es ningún centro ni ningún usuario. */
const SIN_DUENO = `
  NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id::text = split_part(o.name, '/', 1))
  AND NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id::text = split_part(o.name, '/', 1))`

function literalTexto(valores) {
  return `ARRAY[${valores.map((v) => `'${v}'`).join(',')}]::text[]`
}

function sqlFicheros(huellas) {
  return `
    SELECT md5(o.bucket_id || '/' || o.name) AS huella, o.bucket_id AS bucket, o.name AS nombre,
           (o.metadata->>'size')::int AS tam, o.metadata->>'mimetype' AS mime,
           md5(o.bucket_id || '/' || o.name) = ANY(${literalTexto(huellas)}) AS en_lista,
           (${SIN_DUENO}) AS sin_dueno,
           EXISTS (SELECT 1 FROM public.centros c WHERE c.id::text = split_part(o.name, '/', 1)) AS centro_existe,
           EXISTS (SELECT 1 FROM public.ninos n WHERE n.id::text = split_part(o.name, '/', 2)) AS nino_existe
      FROM storage.objects o
     WHERE md5(o.bucket_id || '/' || o.name) = ANY(${literalTexto(huellas)}) OR (${SIN_DUENO})
     ORDER BY o.bucket_id, o.name`
}

function sqlRecuentos(huellas) {
  return `
    SELECT o.bucket_id AS bucket, count(*)::int AS n,
           md5(coalesce(string_agg(
             concat_ws('|', o.id, o.name, o.owner_id, o.created_at, o.updated_at, o.version, o.metadata::text),
             '/' ORDER BY o.id)
             FILTER (WHERE NOT md5(o.bucket_id || '/' || o.name) = ANY(${literalTexto(huellas)})), '')) AS resto
      FROM storage.objects o GROUP BY o.bucket_id ORDER BY o.bucket_id`
}

/**
 * Cuenta, en cada columna de texto, json o uuid de cada tabla (menos storage.objects), las filas
 * que nombran alguno de `ids` (n) y las que nombran el centro de control (nc).
 */
function sqlReferencias(ids, control) {
  const regex = `(${ids.join('|')})`
  return `
    WITH cols AS (
      SELECT n.nspname AS esquema, c.relname AS tabla, a.attname AS columna,
             (t.typname = 'uuid') AS es_uuid
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_type e ON e.oid = t.typelem AND t.typcategory = 'A'
       WHERE a.attnum > 0 AND NOT a.attisdropped
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
         AND NOT (n.nspname = 'storage' AND c.relname = 'objects')
         AND (t.typcategory = 'S' OR t.typname IN ('json', 'jsonb', 'uuid')
              OR e.typcategory = 'S' OR e.typname IN ('json', 'jsonb', 'uuid'))
         AND has_table_privilege(c.oid, 'SELECT')
    )
    SELECT esquema, tabla, columna, es_uuid,
           (xpath('/row/n/text()', query_to_xml(format(
              CASE WHEN es_uuid
                THEN 'SELECT count(*) AS n FROM %I.%I WHERE %I = ANY(%L::uuid[])'
                ELSE 'SELECT count(*) AS n FROM %I.%I WHERE %I::text ~* %L' END,
              esquema, tabla, columna,
              CASE WHEN es_uuid THEN '{${ids.join(',')}}' ELSE '${regex}' END), false, true, '')))[1]::text::int AS n,
           (xpath('/row/n/text()', query_to_xml(format(
              CASE WHEN es_uuid
                THEN 'SELECT count(*) AS n FROM %I.%I WHERE %I = %L::uuid'
                ELSE 'SELECT count(*) AS n FROM %I.%I WHERE %I::text ~* %L' END,
              esquema, tabla, columna, '${control}'), false, true, '')))[1]::text::int AS nc
      FROM cols ORDER BY 1, 2, 3`
}

/** Con qué tabla no ha podido mirar el escaneo, por falta de permiso: se imprime, no se calla. */
const SQL_SIN_PERMISO = `
  SELECT count(*)::int AS n, coalesce(string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY 1), '') AS tablas
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\\_%' AND NOT has_table_privilege(c.oid, 'SELECT')`

function agrupar(ficheros) {
  const porCentro = new Map()
  for (const f of ficheros) {
    const centro = f.nombre.split('/')[0]
    const fila = porCentro.get(centro) ?? {}
    fila[f.bucket] = (fila[f.bucket] ?? 0) + 1
    porCentro.set(centro, fila)
  }
  return porCentro
}

function contarPorBucket(ficheros) {
  const n = {}
  for (const f of ficheros) n[f.bucket] = (n[f.bucket] ?? 0) + 1
  return n
}

function mismoMapa(a, b) {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...claves].every((k) => (a[k] ?? 0) === (b[k] ?? 0))
}

/**
 * La operación. `sql(consulta)` devuelve las filas de una consulta de SOLO lectura; `storage` es
 * el `.storage` de un cliente con service role. En `modo: 'ensayo'` termina SIEMPRE lanzando
 * «ENSAYO OK, nada borrado»; en `modo: 'aplicar'` borra y devuelve el resumen. Cualquier guarda
 * lanza antes de borrar.
 *
 * @param {{
 *   sql: (consulta: string) => Promise<any[]>,
 *   storage: any,
 *   modo: 'ensayo' | 'aplicar',
 *   huellas?: readonly string[],
 *   esperado?: { total: number, porBucket: Readonly<Record<string, number>>, tamano: number, mime: string },
 *   centroControl?: string,
 *   log?: (linea: string) => unknown,
 * }} opciones
 * @returns {Promise<{ borrados: number, antes: Record<string, number>, despues: Record<string, number> }>}
 */
export async function operar({
  sql,
  storage,
  modo,
  huellas = HUELLAS,
  esperado = ESPERADO,
  centroControl = CENTRO_CONTROL,
  log = (linea) => process.stdout.write(`${linea}\n`),
}) {
  if (modo !== 'ensayo' && modo !== 'aplicar') throw new Error(`modo desconocido: ${modo}`)
  if (!huellas.every((h) => RE_MD5.test(h)) || new Set(huellas).size !== huellas.length) {
    throw new Error('guarda de entrada: la lista de huellas no son md5 distintos')
  }
  if (!RE_UUID.test(centroControl))
    throw new Error('guarda de entrada: el centro de control no es un uuid')
  const fallos = []

  // ── Los ficheros: los de la lista y cualquiera sin dueño ─────────────────────────────────
  const ficheros = await sql(sqlFicheros(huellas))
  const listados = ficheros.filter((f) => f.en_lista)
  const intrusos = ficheros.filter((f) => !f.en_lista)
  const antes = await sql(sqlRecuentos(huellas))
  log(
    `ANTES | ficheros de la lista: ${listados.length} | sin dueño fuera de la lista: ${intrusos.length}`
  )
  log(`ANTES | por bucket: ${antes.map((r) => `${r.bucket} ${r.n}`).join(' · ')}`)

  // Guarda 1: los sin dueño son exactamente los de la lista.
  for (const f of intrusos) {
    fallos.push(`sin dueño y NO está en la lista: ${f.bucket}/${f.nombre} (${f.tam} bytes)`)
  }
  const encontradas = new Set(listados.map((f) => f.huella))
  const faltan = huellas.filter((h) => !encontradas.has(h))
  if (faltan.length > 0) fallos.push(`faltan ${faltan.length} de la lista: ${faltan.join(', ')}`)
  for (const f of listados.filter((f) => !f.sin_dueno)) {
    fallos.push(`está en la lista pero TIENE dueño: ${f.bucket}/${f.nombre}`)
  }

  // Guarda 2: recuento exacto y forma de cada uno.
  if (listados.length !== esperado.total) {
    fallos.push(`recuento: esperaba ${esperado.total} ficheros y hay ${listados.length}`)
  }
  const porBucket = contarPorBucket(listados)
  if (!mismoMapa(porBucket, esperado.porBucket)) {
    fallos.push(
      `recuento por bucket: esperaba ${JSON.stringify(esperado.porBucket)} y hay ${JSON.stringify(porBucket)}`
    )
  }
  const ids = new Set()
  for (const f of listados) {
    const partes = f.nombre.split('/')
    const forma =
      partes.length === 3 &&
      RE_UUID.test(partes[0]) &&
      RE_UUID.test(partes[1]) &&
      partes[2] === `${f.bucket}.pdf`
    if (!forma) fallos.push(`forma: ${f.bucket}/${f.nombre} no es {uuid}/{uuid}/${f.bucket}.pdf`)
    else {
      ids.add(partes[0])
      ids.add(partes[1])
    }
    if (f.tam !== esperado.tamano)
      fallos.push(
        `tamaño: ${f.bucket}/${f.nombre} tiene ${f.tam} bytes, esperaba ${esperado.tamano}`
      )
    if (f.mime !== esperado.mime)
      fallos.push(`tipo: ${f.bucket}/${f.nombre} es ${f.mime}, esperaba ${esperado.mime}`)
    if (f.centro_existe) fallos.push(`su centro existe: ${f.bucket}/${f.nombre}`)
    if (f.nino_existe) fallos.push(`su niño existe: ${f.bucket}/${f.nombre}`)
  }

  // Guarda 3: ninguna fila apunta a ninguno, con el control positivo en la misma pasada.
  let columnas = 0
  if (ids.size > 0) {
    const refs = await sql(sqlReferencias([...ids], centroControl))
    columnas = refs.length
    const conRef = refs.filter((r) => r.n > 0)
    const conControl = refs.filter((r) => r.nc > 0)
    const sinPermiso = (await sql(SQL_SIN_PERMISO))[0]
    log(
      `REFERENCIAS | ${columnas} columnas (${refs.filter((r) => r.es_uuid).length} uuid) | ` +
        `con alguno de los ${ids.size} ids: ${conRef.length} | ` +
        `control ${centroControl.slice(0, 8)}: aparece en ${conControl.length} columnas | ` +
        `tablas sin permiso de lectura: ${sinPermiso.n}${sinPermiso.n > 0 ? ` (${sinPermiso.tablas})` : ''}`
    )
    for (const r of conRef)
      fallos.push(`referencia: ${r.n} filas de ${r.esquema}.${r.tabla}.${r.columna} nombran alguno`)
    if (conControl.length === 0) {
      fallos.push(
        `control positivo: el escaneo no encuentra ni el centro de control ${centroControl}; no está mirando nada`
      )
    }
  }

  // Guarda 4: la API dice que existen (si no, el «ya no está» del final no demostraría nada).
  for (const f of listados) {
    const { data, error } = await storage.from(f.bucket).exists(f.nombre)
    if (data !== true)
      fallos.push(
        `la API no lo ve antes de borrar: ${f.bucket}/${f.nombre} (${error?.message ?? data})`
      )
  }

  // Lo que se va a borrar, por bucket y por centro.
  const buckets = Object.keys(esperado.porBucket).sort()
  log(`POR CENTRO | centro | ${buckets.join(' | ')}`)
  for (const [centro, fila] of agrupar(listados)) {
    log(`POR CENTRO | ${centro} | ${buckets.map((b) => fila[b] ?? 0).join(' | ')}`)
  }
  log(`TOTAL | ${buckets.map((b) => `${b} ${porBucket[b] ?? 0}`).join(' · ')} | ${listados.length}`)

  if (fallos.length > 0) throw new Error(`GUARDA: no se borra nada | ${fallos.join(' | ')}`)

  if (modo === 'ensayo') {
    throw new Error(
      `ENSAYO OK, nada borrado | ${listados.length} ficheros de la lista, 0 sin dueño fuera de ella | ` +
        `0 referencias en ${columnas} columnas, control presente | la API ve los ${listados.length}`
    )
  }

  // ── Borrado: por la API, con los nombres de la lista y ninguno más ──────────────────────
  for (const b of buckets) {
    const nombres = listados.filter((f) => f.bucket === b).map((f) => f.nombre)
    const { data, error } = await storage.from(b).remove(nombres)
    const devueltos = (data ?? []).map((o) => o.name).sort()
    log(
      `BORRADO | ${b}: pedidos ${nombres.length}, la API devuelve ${devueltos.length}${error ? ` | error: ${error.message}` : ''}`
    )
    if (error) fallos.push(`remove en ${b}: ${error.message}`)
    if (JSON.stringify(devueltos) !== JSON.stringify([...nombres].sort())) {
      fallos.push(`remove en ${b}: devuelve otros nombres que los pedidos`)
    }
  }

  // ── Después: que YA NO ESTÁN, no que la API diera 200 ──────────────────────────────────
  const quedan = (await sql(sqlFicheros(huellas))).filter((f) => f.en_lista)
  const despues = await sql(sqlRecuentos(huellas))
  log(`DESPUÉS | ficheros de la lista en storage.objects: ${quedan.length}`)
  log(`DESPUÉS | por bucket: ${despues.map((r) => `${r.bucket} ${r.n}`).join(' · ')}`)
  for (const f of quedan) fallos.push(`sigue en storage.objects: ${f.bucket}/${f.nombre}`)
  let siguenEnApi = 0
  for (const f of listados) {
    const { data } = await storage.from(f.bucket).exists(f.nombre)
    if (data !== false) {
      siguenEnApi++
      fallos.push(`la API sigue viéndolo: ${f.bucket}/${f.nombre}`)
    }
  }
  const nAntes = Object.fromEntries(antes.map((r) => [r.bucket, r.n]))
  const nDespues = Object.fromEntries(despues.map((r) => [r.bucket, r.n]))
  const esperadoDespues = { ...nAntes }
  for (const [b, n] of Object.entries(esperado.porBucket))
    esperadoDespues[b] = (esperadoDespues[b] ?? 0) - n
  for (const b of Object.keys(esperadoDespues))
    if (esperadoDespues[b] === 0) delete esperadoDespues[b]
  if (!mismoMapa(nDespues, esperadoDespues)) {
    fallos.push(
      `recuento después: esperaba ${JSON.stringify(esperadoDespues)} y hay ${JSON.stringify(nDespues)}`
    )
  }
  const restoAntes = Object.fromEntries(antes.map((r) => [r.bucket, r.resto]))
  for (const r of despues) {
    if (r.resto !== restoAntes[r.bucket])
      fallos.push(`ha cambiado algún fichero de ${r.bucket} que no es de la lista`)
  }
  log(`DESPUÉS | la API ve ${siguenEnApi} de los ${listados.length}`)

  if (fallos.length > 0)
    throw new Error(`GUARDA DESPUÉS DE BORRAR: revisar a mano | ${fallos.join(' | ')}`)

  const resumen = { borrados: listados.length, antes: nAntes, despues: nDespues }
  log(
    `HECHO | ${listados.length} borrados y comprobados: ni en storage.objects ni en la API; el resto idéntico`
  )
  return resumen
}

// ── CLI: producción, por la Management API (SQL de solo lectura) y la API de Storage ───────
async function main() {
  const modos = process.argv.slice(2).filter((a) => a === '--ensayo' || a === '--aplicar')
  if (modos.length !== 1 || process.argv.length !== 3) {
    console.error(
      'Uso: node supabase/operaciones/20270106120000_borrar_huerfanos_storage.mjs --ensayo | --aplicar'
    )
    process.exit(2)
  }
  config({ path: '.env.local', quiet: true })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(url ?? '')?.[1]
  if (!ref || !servicio || !token) {
    console.error(
      'Faltan en .env.local NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ACCESS_TOKEN'
    )
    process.exit(2)
  }
  process.stdout.write(`PROYECTO | ${ref} | modo ${modos[0].slice(2)}\n`)

  const sql = async (consulta) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: consulta, read_only: true }),
    })
    const cuerpo = await r.text()
    if (!r.ok) throw new Error(`SQL ${r.status}: ${cuerpo}`)
    return JSON.parse(cuerpo)
  }
  // El SQL de la operación no puede escribir: se comprueba antes de empezar.
  const [ro] = await sql("SELECT current_setting('transaction_read_only') AS ro")
  if (ro?.ro !== 'on')
    throw new Error(`el SQL no va en solo lectura (transaction_read_only = ${ro?.ro})`)

  const { storage } = createClient(url, servicio, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await operar({ sql, storage, modo: modos[0].slice(2) })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
