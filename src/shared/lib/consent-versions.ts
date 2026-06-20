import type { Database } from '@/types/database'

/**
 * Versiones VIGENTES del consentimiento, POR TIPO (Decisión #13 de
 * `docs/specs/proteccion-datos.md`). El versionado es independiente por tipo:
 * al cambiar el texto legal de un tipo se sube SOLO su versión → re-consentimiento
 * (mostrar de nuevo cuando la versión vigente > la última aceptada). El mecanismo
 * de re-consentimiento existe (comparar este catálogo con la última fila no
 * revocada de `consentimientos`), pero no se dispara hasta el primer cambio de
 * texto post-lanzamiento (no hay usuarios reales hasta cerrar F11).
 *
 * Sustituye al antiguo `CONSENT_VERSION = 'v1.0'` único hardcoded. Hoy todos
 * arrancan en `v1.0` (marcador); el texto definitivo del abogado, al cierre de
 * F11, subirá la versión del tipo que cambie.
 *
 * El tipo `imagen` se captura por la firma F8 (no por estos RPC); se incluye
 * aquí por completitud del catálogo.
 */
export type ConsentTipo = Database['public']['Enums']['consentimiento_tipo']

export const CONSENT_VERSIONS: Record<ConsentTipo, string> = {
  terminos: 'v1.0',
  privacidad: 'v1.0',
  // v2.0 (F11-F): `datos_medicos` pasó de consentimiento de tratamiento a ACUSE de
  // confidencialidad (texto nuevo, sin firma). Las filas v1.0 quedan como histórico.
  datos_medicos: 'v2.0',
  imagen: 'v1.0',
}

/** Tipos obligatorios en el alta (los que se capturan en accept-invitation). */
export const CONSENT_OBLIGATORIOS: ConsentTipo[] = ['terminos', 'privacidad']

/**
 * Mecanismo de re-consentimiento (#13): TRUE si la versión aceptada por el
 * usuario para un tipo quedó por debajo de la vigente (o nunca aceptó). No se
 * cablea a UI en esta pieza; lo usará la gestión de consentimientos.
 */
export function necesitaReconsentimiento(
  tipo: ConsentTipo,
  versionAceptada: string | null
): boolean {
  return versionAceptada !== CONSENT_VERSIONS[tipo]
}
