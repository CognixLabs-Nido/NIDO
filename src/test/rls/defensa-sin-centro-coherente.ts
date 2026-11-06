import { execFileSync } from 'node:child_process'

/**
 * Dos capas contra la fila que cruza centros: la de antes (la RLS, una FK) y `zz_centro_coherente`
 * (20270108120000), que corre ANTES (es un BEFORE trigger) y por eso es la que se ve. Un test que
 * solo afirma el código del trigger es una prueba de una capa: si mañana se quita el trigger, la de
 * antes no la mira nadie. Con esto, cada test afirma las dos:
 *
 * - `hayCentroCoherente(tabla)`: si la tabla tiene el trigger. El test espera su código (23514,
 *   HINT `centro_ajeno`) si está, y el de la defensa de antes si no: quitar el trigger deja el test
 *   en verde por la defensa vieja, no en rojo (el que se pone rojo es `centro-coherente.rls.test.ts`).
 * - `comoSesionSinCentroCoherente(uid, tabla, sql)`: la MISMA escritura con la sesión de `uid` (rol
 *   `authenticated` y sus claims, como PostgREST), con el trigger deshabilitado dentro de una
 *   transacción que se deshace: lo que contesta es la defensa de antes, sola.
 *
 * Por psql como `postgres` contra la BD efímera del CI (`DB_URL`); fuera del CI falla. El
 * `ALTER TABLE … DISABLE TRIGGER` bloquea la tabla hasta el ROLLBACK (milisegundos).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TABLA = /^[a-z_][a-z0-9_]*$/

export interface ErrorSql {
  code: string
  message: string
}

function psql(sql: string): string {
  const url = process.env.DB_URL
  if (!url)
    throw new Error('DB_URL: la defensa sin el trigger solo se mide en la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
}

function tablaValida(tabla: string): string {
  if (!TABLA.test(tabla)) throw new Error(`defensa-sin-centro-coherente: tabla ${tabla}`)
  return tabla
}

export function hayCentroCoherente(tabla: string): boolean {
  const t = tablaValida(tabla)
  const salida = psql(
    `SELECT 'n|' || count(*) FROM pg_trigger WHERE tgrelid = 'public.${t}'::regclass AND tgname = 'zz_centro_coherente' AND tgenabled = 'O';`
  )
  const linea = salida.split('\n').find((l) => l.startsWith('n|'))
  if (linea === undefined) throw new Error(`hayCentroCoherente: sin respuesta: ${salida}`)
  return linea === 'n|1'
}

/**
 * Ejecuta `sql` con la sesión de `uid` y SIN `zz_centro_coherente` en `tabla`, y lo deshace todo.
 * Devuelve `{ filas }` si pasa y `{ error }` si no.
 */
export function comoSesionSinCentroCoherente(
  uid: string,
  tabla: string,
  sql: string
): { filas: number | null; error: ErrorSql | null } {
  if (!UUID.test(uid)) throw new Error(`defensa-sin-centro-coherente: uid ${uid}`)
  const t = tablaValida(tabla)
  if (sql.includes('$q$'))
    throw new Error('defensa-sin-centro-coherente: el SQL no puede llevar $q$')
  const salida = psql(
    [
      'BEGIN;',
      `DO $d$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.${t}'::regclass AND tgname = 'zz_centro_coherente') THEN
           ALTER TABLE public.${t} DISABLE TRIGGER zz_centro_coherente;
         END IF;
       END $d$;`,
      `CREATE FUNCTION pg_temp.q() RETURNS text LANGUAGE plpgsql AS $f$
       DECLARE st text; msg text; n int;
       BEGIN
         PERFORM set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
         PERFORM set_config('request.jwt.claim.sub', '${uid}', true);
         SET LOCAL ROLE authenticated;
         EXECUTE $q$${sql}$q$;
         GET DIAGNOSTICS n = ROW_COUNT;
         RESET ROLE;
         RETURN 'ok|' || n;
       EXCEPTION WHEN OTHERS THEN
         GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
         RETURN 'error|' || st || '|' || msg;
       END $f$;`,
      'SELECT pg_temp.q();',
      'ROLLBACK;',
    ].join('\n')
  )
  const linea = salida.split('\n').find((l) => l.startsWith('ok|') || l.startsWith('error|'))
  if (linea === undefined) throw new Error(`comoSesionSinCentroCoherente: sin respuesta: ${salida}`)
  if (linea.startsWith('ok|')) return { filas: Number(linea.slice(3)), error: null }
  const [, code, ...message] = linea.split('|')
  return { filas: null, error: { code, message: message.join('|') } }
}
