import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'

/**
 * Limpieza de datos personales ANTES de que un evento salga hacia Sentry (ADR-0056).
 *
 * NIDO trata datos de menores: a Sentry solo llega lo necesario para entender un fallo
 * técnico. Este módulo es la última barrera y no confía en las anteriores
 * (`dataCollection` apagado, el convenio de no loguear datos personales):
 *
 *  - fuera `user`, las cabeceras, cookies, cuerpo y query de la petición, y las variables
 *    locales de los stack frames;
 *  - cualquier campo cuyo NOMBRE suene a dato personal (email, DNI, teléfono, nombre,
 *    dirección, salud, notas, firma, foto, credenciales…) se sustituye entero;
 *  - en todo texto que quede (mensaje, excepción, migas, URLs) se tachan los patrones
 *    reconocibles: email, DNI/NIE, IBAN, teléfono, UUID, tokens, y la query de las URLs;
 *  - las migas de consola y de interfaz (clics, teclado) se descartan: pueden llevar
 *    cualquier cosa que el usuario vio o escribió.
 *
 * LÍMITE CONOCIDO: un nombre propio suelto dentro de un texto libre no tiene patrón. Lo
 * cubre el convenio de no meter datos personales en errores ni logs; el detalle completo
 * se queda en los logs de Vercel, que son nuestra infraestructura.
 */

const TACHADO = '[filtrado]'

/** Patrones de texto, en orden: los largos antes que los que podrían pisarlos. */
const PATRONES: ReadonlyArray<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/gi, '$1?[query]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, '[iban]'],
  [/\b[XYZ][-\s]?\d{7}[-\s]?[A-HJ-NP-TV-Z]\b/gi, '[dni]'],
  [/\b\d{8}[-\s]?[A-HJ-NP-TV-Z]\b/gi, '[dni]'],
  [/(?:\+34[\s-]?)?\b[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, '[telefono]'],
]

/** Tacha en un texto todos los patrones reconocibles de dato personal. */
export function limpiarTexto(texto: string): string {
  let out = texto
  for (const [patron, sustituto] of PATRONES) out = out.replace(patron, sustituto)
  return out
}

/**
 * Segmentos de nombre de campo que delatan un dato personal o un secreto. Se comparan
 * contra el nombre normalizado (`fechaNacimiento` → `fecha_nacimiento`) por segmentos,
 * para que `tipo` no case con `ip` ni `nombreArchivo`… sí case con `nombre` (mejor de más).
 */
const SEGMENTOS_SENSIBLES = [
  'email',
  'mail',
  'correo',
  'dni',
  'nie',
  'nif',
  'documento',
  'telefono',
  'tel',
  'phone',
  'movil',
  'mobile',
  'iban',
  'bic',
  'cuenta',
  'nombre',
  'apellido',
  'apellidos',
  'username',
  'direccion',
  'address',
  'domicilio',
  'calle',
  'postal',
  'nacimiento',
  'birth',
  'birthday',
  'alergia',
  'alergias',
  'medico',
  'medica',
  'medicacion',
  'medicamento',
  'enfermedad',
  'enfermedades',
  'diagnostico',
  'salud',
  'health',
  'tratamiento',
  'dosis',
  'pauta',
  'observacion',
  'observaciones',
  'nota',
  'notas',
  'comentario',
  'descripcion',
  'contenido',
  'mensaje',
  'texto',
  'body',
  'personas',
  'firma',
  'signature',
  'foto',
  'imagen',
  'photo',
  'avatar',
  'password',
  'contrasena',
  'token',
  'secret',
  'cookie',
  'cookies',
  'authorization',
  'auth',
  'session',
  'jwt',
  'apikey',
  'ip',
]
const NOMBRES_COMPUESTOS = /(^|_)(first|last|full|user|display)_?name(_|$)/

function normalizarClave(clave: string): string {
  return clave
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
}

/** ¿El nombre de este campo delata un dato personal o un secreto? */
export function claveSensible(clave: string): boolean {
  const norm = normalizarClave(clave)
  if (NOMBRES_COMPUESTOS.test(norm)) return true
  const segmentos = norm.split('_').filter(Boolean)
  return segmentos.some((s) => SEGMENTOS_SENSIBLES.includes(s))
}

/** Limpia un valor cualquiera: textos tachados, campos sensibles sustituidos, recursivo. */
function limpiarValor(valor: unknown, profundidad = 0): unknown {
  if (typeof valor === 'string') return limpiarTexto(valor)
  if (valor === null || typeof valor !== 'object') return valor
  if (profundidad > 8) return TACHADO
  if (Array.isArray(valor)) return valor.map((v) => limpiarValor(v, profundidad + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor)) {
    out[k] = claveSensible(k) ? TACHADO : limpiarValor(v, profundidad + 1)
  }
  return out
}

/** Una URL sin query ni fragmento, con los identificadores tachados. */
export function limpiarUrl(url: string): string {
  try {
    const u = new URL(url, 'http://relativa.invalid')
    const base = u.origin === 'http://relativa.invalid' ? '' : u.origin
    return limpiarTexto(`${base}${u.pathname}`)
  } catch {
    return limpiarTexto(url.split(/[?#]/)[0] ?? '')
  }
}

/** Categorías de miga que se descartan enteras: llevan lo que el usuario vio o tecleó. */
const MIGAS_DESCARTADAS = /^(console|ui\.|sentry\.)/

/** Limpia una miga; `null` = no se envía. */
export function limpiarMiga(miga: Breadcrumb): Breadcrumb | null {
  if (miga.category && MIGAS_DESCARTADAS.test(miga.category)) return null
  const data = miga.data ? { ...miga.data } : undefined
  if (data) {
    for (const campo of ['url', 'from', 'to'] as const) {
      if (typeof data[campo] === 'string') data[campo] = limpiarUrl(data[campo])
    }
  }
  return {
    ...miga,
    ...(miga.message !== undefined ? { message: limpiarTexto(miga.message) } : {}),
    ...(data ? { data: limpiarValor(data) as Breadcrumb['data'] } : {}),
  }
}

/**
 * Limpia un evento de error entero antes de enviarlo (es el `beforeSend`). Devuelve un
 * evento nuevo: no muta el original.
 */
export function limpiarEvento(evento: ErrorEvent): ErrorEvent {
  const e: ErrorEvent = { ...evento }

  delete e.user
  delete e.server_name

  if (e.request) {
    e.request = {
      ...(e.request.method ? { method: e.request.method } : {}),
      ...(e.request.url ? { url: limpiarUrl(e.request.url) } : {}),
    }
  }

  if (e.message !== undefined) e.message = limpiarTexto(e.message)
  if (e.transaction !== undefined) e.transaction = limpiarTexto(e.transaction)
  if (e.logentry) {
    e.logentry = {
      ...(e.logentry.message !== undefined ? { message: limpiarTexto(e.logentry.message) } : {}),
      ...(e.logentry.params ? { params: e.logentry.params.map((p) => limpiarValor(p)) } : {}),
    }
  }

  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((ex) => ({
        ...ex,
        ...(ex.value !== undefined ? { value: limpiarTexto(ex.value) } : {}),
        ...(ex.stacktrace?.frames
          ? {
              stacktrace: {
                ...ex.stacktrace,
                frames: ex.stacktrace.frames.map(({ vars: _vars, ...frame }) => frame),
              },
            }
          : {}),
      })),
    }
  }

  if (e.breadcrumbs) {
    e.breadcrumbs = e.breadcrumbs.map(limpiarMiga).filter((b): b is Breadcrumb => b !== null)
  }
  if (e.extra) e.extra = limpiarValor(e.extra) as ErrorEvent['extra']
  if (e.contexts) e.contexts = limpiarValor(e.contexts) as ErrorEvent['contexts']
  if (e.tags) e.tags = limpiarValor(e.tags) as ErrorEvent['tags']

  return e
}
