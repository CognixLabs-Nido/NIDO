import type { CentroDelUsuario } from './resolver'

/**
 * Centro de una notificación push (multicentro). Módulo puro: sin BD, sin cookies, sin Next.
 *
 * El enlace de la notificación lleva el centro del registro (`?centro=`). Al abrirlo, si ese
 * centro es otro de los del usuario, la página pide confirmación para cambiar
 * (`ConfirmarCentroDelAviso`) y no enseña nada más; si es el activo, o no es uno de los suyos, se
 * abre como siempre. El cambio lo hace la acción `elegirCentro` al pulsar el botón, nunca el
 * enlace: un enlace de fuera no puede cambiarle el centro a nadie (MisterFC #755: el centro lo
 * elige el usuario).
 */

export const PARAM_CENTRO_DEL_AVISO = 'centro'

/** La ruta de la notificación con su centro: `/es/messages?nino=x` → `…&centro=c`. */
export function urlDelAviso(ruta: string, centroId: string): string {
  const separador = ruta.includes('?') ? '&' : '?'
  return `${ruta}${separador}${PARAM_CENTRO_DEL_AVISO}=${encodeURIComponent(centroId)}`
}

/**
 * El centro que hay que confirmar antes de abrir la notificación, o `null` si se abre como
 * siempre: sin centro en el enlace, el centro activo, o uno que no es del usuario (un rol
 * retirado, un enlace manipulado). En ese último caso la página hace lo de siempre con el
 * registro de otro centro: «no encontrado» o ignorarlo.
 */
export function centroDelAvisoPorConfirmar(
  contexto: { centroId: string; centros: ReadonlyArray<CentroDelUsuario> },
  centroDelEnlace: string | string[] | undefined
): string | null {
  if (typeof centroDelEnlace !== 'string' || centroDelEnlace === contexto.centroId) return null
  return contexto.centros.some((c) => c.centroId === centroDelEnlace) ? centroDelEnlace : null
}
