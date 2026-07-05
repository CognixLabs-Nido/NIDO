import 'server-only'

/**
 * PR-3b-2 · B1 — decisión del gate de entrada al wizard de alta (`/alta/[ninoId]`).
 *
 * Aísla la lógica de autorización de la ruta en una función pura y testeable (el
 * componente RSC no es testeable directamente). La ruta le pasa dos señales ya
 * resueltas contra BD y actúa según el veredicto.
 *
 * MODELO "Completa Dirección" (B1): la Directora del centro puede ABRIR el wizard de
 * un niño de SU centro para CARGAR la documentación en papel (las matrículas se
 * hicieron y firmaron físicamente). NO es impersonación: la firma va a nombre de la
 * Directora con marca `metodo_firma='presencial'` (eso lo cablea B2). B1 solo abre la
 * ENTRADA y muestra el shell; los write-paths de dirección-menor/libro/firma siguen
 * fallando con admin hasta B2 (esperado).
 *
 * Reglas (en orden):
 * - Con vínculo activo usuario↔niño → entrada normal de tutor (sin modo Dirección).
 *   Cubre tutor legal y `autorizado` (mismo comportamiento que ya existía; B1 no toca
 *   esa rama).
 * - Sin vínculo, admin DEL CENTRO DEL NIÑO → entrada en MODO DIRECCIÓN.
 * - Sin vínculo, profe del centro del niño → fuera (a su panel).
 * - Cualquier otro (admin de OTRO centro → sin rol en este centro, autorizado sin
 *   vínculo, sin rol) → `notFound`.
 *
 * `rolEnCentroNino` es el rol del usuario EN EL CENTRO DEL NIÑO (la ruta lo resuelve
 * con `getRolEnCentro(nino.centro_id)`, atado al centro del niño, NO al centro
 * "actual" genérico). Un admin de otro centro no tiene rol aquí → `null` → `notFound`.
 */
export type EntradaAlta =
  | { tipo: 'tutor' }
  | { tipo: 'direccion' }
  | { tipo: 'redirect'; destino: 'admin' | 'teacher' }
  | { tipo: 'notfound' }

export function resolverEntradaAlta(params: {
  tieneVinculo: boolean
  rolEnCentroNino: string | null
}): EntradaAlta {
  if (params.tieneVinculo) return { tipo: 'tutor' }
  if (params.rolEnCentroNino === 'admin') return { tipo: 'direccion' }
  if (params.rolEnCentroNino === 'profe') return { tipo: 'redirect', destino: 'teacher' }
  return { tipo: 'notfound' }
}
