/**
 * Qué cambia de verdad (puerta de identidad, 2026-11-08). La cola de Dirección solo recibe lo que
 * CAMBIA respecto a lo guardado: una entrada que no cambia nada enseña a aprobar sin mirar.
 *
 * Las normalizaciones son las MISMAS que aplica la base al escribir (`actualizar_identidad_nino_tutor`,
 * 20270113120000): si aquí y allí se normalizara distinto, la app encolaría lo que la base daría por
 * igual, o al revés. Funciones puras: sin red ni sesión, para poder probarlas solas.
 */

/** Los ocho campos que identifican al niño: con el alta validada van a la cola (decidido 2026-11-07). */
export const CAMPOS_IDENTIDAD_COLA = [
  'nombre',
  'primer_apellido',
  'segundo_apellido',
  'fecha_nacimiento',
  'sexo',
  'nacionalidad',
  'lugar_nacimiento',
  'dni',
] as const

export type CampoIdentidadCola = (typeof CAMPOS_IDENTIDAD_COLA)[number]

/** `btrim` y vacío → NULL, como `NULLIF(btrim(x), '')`. */
export function textoONull(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

/** El DNI como lo guarda la base: sin espacios, puntos ni guiones, en mayúsculas; vacío → NULL. */
export function normalizarDni(v: string): string | null {
  const s = v.replace(/[\s.-]/g, '').toUpperCase()
  return s === '' ? null : s
}

export interface IdentidadPropuesta {
  nombre?: string | null
  primer_apellido?: string | null
  segundo_apellido?: string | null
  fecha_nacimiento?: string | null
  sexo?: 'F' | 'M' | 'X' | null
  nacionalidad?: string | null
  lugar_nacimiento?: string | null
  dni?: string | null
}

export interface IdentidadGuardada {
  nombre: string | null
  primer_apellido: string | null
  segundo_apellido: string | null
  fecha_nacimiento: string | null
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  lugar_nacimiento: string | null
  dni: string | null
}

export type CambiosIdentidad = Partial<Record<CampoIdentidadCola, string | null>>

/**
 * Los campos de identidad que cambian, ya normalizados. Mismo contrato que la función de la base:
 * NULL (o ausente) = «no tocar»; los apellidos van en pareja (con el primero llega el segundo, y
 * vacío es «no tiene»); el lugar y el DNI, vacío = borrar.
 */
export function cambiosIdentidad(
  propuesta: IdentidadPropuesta,
  guardada: IdentidadGuardada
): CambiosIdentidad {
  const c: CambiosIdentidad = {}
  if (propuesta.nombre != null && propuesta.nombre !== guardada.nombre) c.nombre = propuesta.nombre
  if (propuesta.primer_apellido != null) {
    const primero = propuesta.primer_apellido.trim()
    const segundo = textoONull(propuesta.segundo_apellido ?? '')
    if (primero !== guardada.primer_apellido) c.primer_apellido = primero
    if (segundo !== guardada.segundo_apellido) c.segundo_apellido = segundo
  }
  if (
    propuesta.fecha_nacimiento != null &&
    propuesta.fecha_nacimiento !== guardada.fecha_nacimiento
  )
    c.fecha_nacimiento = propuesta.fecha_nacimiento
  if (propuesta.sexo != null && propuesta.sexo !== guardada.sexo) c.sexo = propuesta.sexo
  if (propuesta.nacionalidad != null && propuesta.nacionalidad !== guardada.nacionalidad)
    c.nacionalidad = propuesta.nacionalidad
  if (propuesta.lugar_nacimiento != null) {
    const lugar = textoONull(propuesta.lugar_nacimiento)
    if (lugar !== guardada.lugar_nacimiento) c.lugar_nacimiento = lugar
  }
  if (propuesta.dni != null) {
    const dni = normalizarDni(propuesta.dni)
    if (dni !== guardada.dni) c.dni = dni
  }
  return c
}

/**
 * Las claves de un parche que cambian respecto a lo guardado (las `undefined` no se tocan; NULL y
 * ausente valen lo mismo). Para la dirección del niño, que se aplica como parche parcial.
 */
export function clavesQueCambian<T extends Record<string, unknown>>(
  parche: T,
  guardado: Partial<Record<keyof T, unknown>> | null
): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(parche) as (keyof T)[]) {
    const v = parche[k]
    if (v === undefined) continue
    if ((v ?? null) !== ((guardado?.[k] as unknown) ?? null)) out[k] = v
  }
  return out
}
