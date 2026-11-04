import { execFileSync } from 'node:child_process'

/**
 * `mandatos_sepa` solo se escribe por sus funciones (`20261225120000`): ni las sesiones ni
 * `service_role` tienen INSERT, UPDATE, DELETE ni TRUNCATE. Los tests que necesitan un mandato a
 * mano (un IBAN de mentira, un segundo activo para probar el índice, la limpieza del final) lo
 * escriben aquí: como `postgres`, el dueño de la tabla, por psql contra la BD efímera del CI
 * (`DB_URL`). La app no tiene este camino.
 *
 * Fuera del CI no hay `DB_URL` y falla: estos tests solo corren contra la BD efímera.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COLUMNA = /^[a-z_][a-z0-9_]*$/

export interface ErrorMandato {
  code: string
  message: string
}

function psql(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: el mandato solo se escribe así en la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
}

function columnas(fila: object): string {
  const cols = Object.keys(fila)
  if (cols.length === 0) throw new Error('mandatos-como-postgres: fila vacía')
  for (const c of cols) if (!COLUMNA.test(c)) throw new Error(`mandatos-como-postgres: ${c}`)
  return cols.join(', ')
}

function json(fila: object): string {
  const j = JSON.stringify(fila)
  if (j.includes('$j$')) throw new Error('mandatos-como-postgres: la fila no puede llevar $j$')
  return `$j$${j}$j$::jsonb`
}

/** Lee la línea `ok|…` o `error|código|mensaje` que devuelve la función temporal. */
function respuesta(salida: string): { valor: string | null; error: ErrorMandato | null } {
  const linea = salida.split('\n').find((l) => l.startsWith('ok|') || l.startsWith('error|'))
  if (linea === undefined) throw new Error(`mandatos-como-postgres: sin respuesta: ${salida}`)
  if (linea.startsWith('ok|')) return { valor: linea.slice(3), error: null }
  const [, code, ...message] = linea.split('|')
  return { valor: null, error: { code, message: message.join('|') } }
}

function comoFuncion(cuerpo: string, arg: string): string {
  return psql(
    [
      'BEGIN;',
      `CREATE FUNCTION pg_temp.m(j jsonb) RETURNS text LANGUAGE plpgsql AS $f$
       DECLARE r text; st text; msg text;
       BEGIN
         ${cuerpo}
       EXCEPTION WHEN OTHERS THEN
         GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
         RETURN 'error|' || st || '|' || msg;
       END $f$;`,
      `SELECT pg_temp.m(${arg});`,
      'COMMIT;',
    ].join('\n')
  )
}

/**
 * Un mandato con las columnas que se le pasan; las que no, con su DEFAULT. Como el INSERT de supabase-js.
 *
 * Sin `version_canonico`, un v2 completo (desde `20261230120000` no se crean mandatos v1): hash,
 * documento y dirección del titular de prueba y el CID y el nombre DEL CENTRO de la fila, leídos de
 * `centros` (un centro sin CID no da mandato: el CHECK lo rechaza). Lo que se le pase manda.
 */
export function insertarMandato(fila: object): {
  data: { id: string } | null
  error: ErrorMandato | null
} {
  const v2 = !('version_canonico' in fila)
  const completa = v2
    ? {
        version_canonico: 2,
        texto_hash: 'a'.repeat(64),
        titular_documento: 'X1234567L',
        titular_direccion: 'Calle Prueba 1, Valencia',
        ...fila,
      }
    : fila
  const cols = columnas(completa) + (v2 ? ', acreedor_cid, acreedor_nombre' : '')
  const { valor, error } = respuesta(
    comoFuncion(
      `${
        v2
          ? `j := j || (SELECT jsonb_build_object('acreedor_cid', c.identificador_acreedor, 'acreedor_nombre', c.nombre)
                FROM public.centros c WHERE c.id = (j->>'centro_id')::uuid);`
          : ''
      }
       INSERT INTO public.mandatos_sepa (${cols})
         SELECT ${cols} FROM jsonb_populate_record(NULL::public.mandatos_sepa, j) RETURNING id INTO r;
       RETURN 'ok|' || r;`,
      json(completa)
    )
  )
  return { data: valor === null ? null : { id: valor }, error }
}

/**
 * Un mandato v1 de los que ya existían (FICCIÓN de los tests, 2026-11-04: los 3 que había en
 * producción cuando se cerró el v1, `20261230120000`). El trigger `mandatos_sepa_v1_cerrado` no deja
 * crear ninguno, así que se apaga solo para este INSERT, en su transacción, y se vuelve a encender.
 * Sirve para probar lo que se puede hacer con uno que ya existe: revocarlo, borrarlo o volver a
 * firmarlo como v2. Con `iban`, lo cifra como `registrar_mandato_sepa` (el reintento del alta lo
 * descifra para comparar). La app no tiene este camino.
 */
export function insertarMandatoV1Existente(
  fila: object,
  opciones: { iban?: string } = {}
): {
  data: { id: string } | null
  error: ErrorMandato | null
} {
  const { iban } = opciones
  if (iban !== undefined && !/^[A-Z0-9]{15,34}$/.test(iban)) {
    throw new Error(`mandatos-como-postgres: IBAN no válido: ${iban}`)
  }
  const completa = { ...fila, version_canonico: 1, ...(iban ? { iban_cifrado: '\\x00' } : {}) }
  const cols = columnas(completa)
  const cifra = iban
    ? `j := j || jsonb_build_object('iban_cifrado', extensions.pgp_sym_encrypt('${iban}', public._get_sepa_key())::text);`
    : ''
  const { valor, error } = respuesta(
    comoFuncion(
      `${cifra}
       ALTER TABLE public.mandatos_sepa DISABLE TRIGGER mandatos_sepa_v1_cerrado;
       INSERT INTO public.mandatos_sepa (${cols})
         SELECT ${cols} FROM jsonb_populate_record(NULL::public.mandatos_sepa, j) RETURNING id INTO r;
       ALTER TABLE public.mandatos_sepa ENABLE TRIGGER mandatos_sepa_v1_cerrado;
       RETURN 'ok|' || r;`,
      json(completa)
    )
  )
  return { data: valor === null ? null : { id: valor }, error }
}

/** Cambia las columnas dadas de un mandato. El mandato tiene que existir. */
export function actualizarMandato(id: string, cambios: object): { error: ErrorMandato | null } {
  if (!UUID.test(id)) throw new Error(`mandatos-como-postgres: id no válido: ${id}`)
  const cols = columnas(cambios)
  const { error } = respuesta(
    comoFuncion(
      `UPDATE public.mandatos_sepa m SET (${cols}) = (SELECT ${cols} FROM jsonb_populate_record(NULL::public.mandatos_sepa, j))
         WHERE m.id = '${id}';
       IF NOT FOUND THEN RETURN 'error|P0002|mandato no encontrado'; END IF;
       RETURN 'ok|';`,
      json(cambios)
    )
  )
  return { error }
}

/** La limpieza: borra los mandatos cuyo `columna` es `valor`. Falla si el borrado falla. */
export function borrarMandatos(
  columna: 'centro_id' | 'familia_id' | 'nino_id' | 'id',
  valor: string
): void {
  if (!UUID.test(valor)) throw new Error(`mandatos-como-postgres: ${columna} no válido: ${valor}`)
  const { error } = respuesta(
    comoFuncion(
      `DELETE FROM public.mandatos_sepa WHERE ${columna} = '${valor}';
       RETURN 'ok|';`,
      'NULL'
    )
  )
  if (error) throw new Error(`borrarMandatos: ${error.code} ${error.message}`)
}
