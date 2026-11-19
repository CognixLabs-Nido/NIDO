import { consultaBase } from './columnas-vivas'

/**
 * R4 de la red del export («el uuid de una persona no sale») decidida por la BASE, no por el nombre
 * de la columna (decisión del 2026-11-19, spec `docs/specs/altas-serie.md`, «R4 por el esquema»).
 * Hasta entonces los tests unit comparaban el nombre con una lista escrita a mano
 * (`autor|firmante|usuario…_id`), y `firmas_ficha.tutor_id` (10b-3) entró por la regla de los id
 * corrientes: en verde, porque estaba decidida `noSale`, y sin que nadie mirara R4.
 *
 * Una columna es de persona si tiene clave ajena a una de estas tablas. La que venga mañana entra
 * sola, sin tocar ninguna lista.
 */
const TABLAS_DE_PERSONA = ['public.usuarios', 'public.familia_tutores', 'auth.users'] as const

/**
 * Lo que el esquema NO alcanza: los uuid (o uuid[]) sin clave ajena que no son la clave primaria.
 * Cada uno tiene que estar aquí, decidido (persona o no) y con su porqué; uno nuevo sin decidir pone
 * rojo `export-columnas.rls.test.ts`, y uno de aquí que deje de existir, también. Sin esta lista,
 * cambiar el nombre por el esquema solo habría movido el punto ciego: lo que el esquema no ve se
 * colaría en silencio.
 *
 * Si vas a añadir uno: ¿puede llevar clave ajena? Entonces pónsela en la migración y no lo añadas
 * aquí. Solo entra lo que no puede (un array, una columna que apunta a tablas distintas según otra).
 */
export const UUID_SIN_CLAVE: Readonly<Record<string, { persona: boolean; porque: string }>> = {
  'olvido_solicitudes.tutores_legales': {
    persona: true,
    porque:
      'uuid[] con los tutores legales del niño al pedir el olvido: son personas, y Postgres no admite clave ajena en un array.',
  },
  'olvido_solicitudes.sujeto_id': {
    persona: true,
    porque:
      'Apunta a un usuario o a un niño según `sujeto_tipo`: una columna que apunta a dos tablas no puede llevar clave ajena. Las dos son personas.',
  },
  'export_log.sujeto_id': {
    persona: true,
    porque:
      'Apunta a un usuario o a un niño según `sujeto_tipo`: una columna que apunta a dos tablas no puede llevar clave ajena. Las dos son personas.',
  },
  'cambios_pendientes.registro_id': {
    persona: false,
    porque:
      'Apunta a la fila cambiada de la tabla que dice `tabla`: puede ser cualquiera, así que no lleva clave ajena. Es una fila, no una persona.',
  },
  'invitaciones.token': {
    persona: false,
    porque: 'Es la clave secreta de la invitación (R6), un uuid aleatorio: no apunta a nada.',
  },
}

export interface ColumnaUuid {
  /** Tiene clave ajena a una de `TABLAS_DE_PERSONA`. */
  claveAPersona: boolean
  /** No tiene ninguna clave ajena y no es (parte de) la clave primaria. */
  sinClave: boolean
}

/**
 * El SQL que pregunta a la base por los uuid (y uuid[]) de `tablas`. Una fila por columna:
 * `tabla|columna|claveAPersona|sinClave`. Suelto para que el control negativo lo corra dentro de su
 * transacción.
 */
export function sqlColumnasUuid(tablas: readonly string[]): string {
  const lista = tablas.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ')
  const destinos = TABLAS_DE_PERSONA.map((t) => `'${t}'::regclass`).join(', ')
  return `SELECT c.relname || '|' || a.attname || '|' ||
       EXISTS (SELECT 1 FROM pg_constraint k
                WHERE k.contype = 'f' AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey)
                  AND k.confrelid IN (${destinos}))::text || '|' ||
       (NOT EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.contype IN ('f', 'p') AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey)))::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE c.relkind = 'r' AND c.relname IN (${lista})
   AND a.atttypid IN ('uuid'::regtype, 'uuid[]'::regtype)
 ORDER BY 1;`
}

/** Lee la salida de `sqlColumnasUuid`: `tabla.columna` → su clase. */
export function leerColumnasUuid(salida: string): Map<string, ColumnaUuid> {
  const m = new Map<string, ColumnaUuid>()
  for (const linea of salida.split('\n').filter(Boolean)) {
    const [t, c, aPersona, sin] = linea.split('|')
    m.set(`${t}.${c}`, { claveAPersona: aPersona === 'true', sinClave: sin === 'true' })
  }
  return m
}

/** Los uuid de `tablas` en la base del CI (solo local: `consultaBase`). */
export function columnasUuid(tablas: readonly string[]): Map<string, ColumnaUuid> {
  return leerColumnasUuid(consultaBase(sqlColumnasUuid(tablas)))
}

/** ¿Es de persona? Por la clave ajena, o por lo decidido en `UUID_SIN_CLAVE`. */
export function esDePersona(uuids: Map<string, ColumnaUuid>, tabla: string, columna: string) {
  const k = `${tabla}.${columna}`
  return uuids.get(k)?.claveAPersona === true || UUID_SIN_CLAVE[k]?.persona === true
}
