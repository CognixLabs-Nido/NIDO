/**
 * Alta unificada · U-5 (D7) — detección "familia nueva vs 2.º hijo" por el EMAIL del tutor.
 *
 * El botón único de admisiones pide siempre lo mismo (datos del niño + email del tutor) y es
 * el servidor quien decide qué clase de prospecto nace. Antes eran DOS puertas distintas y la
 * dirección tenía que acertar cuál abrir; equivocarse era justo lo que hacía desaparecer al
 * 2.º hijo de la lista (U-2).
 *
 * PR 1 (Fase 4): solo cuenta lo que hay en ESTE centro. Una cuenta de otro centro, del personal o
 * a medias se ve igual que un email sin cuenta —familia nueva— y, al promover, se invita: entre
 * centros nadie entra sin aceptar, y la directora no sabe si ese email tiene cuenta en otro sitio
 * (D4).
 */

export type DeteccionTutor =
  /** Sin email, o sin familia en este centro (tenga o no cuenta en NIDO) → alta de familia nueva. */
  | 'familia_nueva'
  /** La cuenta del email tiene perfil en una familia de este centro → 2.º hijo de esa familia. */
  | 'familia_existente'

export interface SenalesTutor {
  /** ¿Se tecleó un email? Sin él no hay nada que resolver. */
  hayEmail: boolean
  /** ¿La cuenta de ese email figura como tutor de alguna familia DEL CENTRO actual? */
  familiaEnEsteCentro: boolean
}

export function detectarTutor(s: SenalesTutor): DeteccionTutor {
  return s.hayEmail && s.familiaEnEsteCentro ? 'familia_existente' : 'familia_nueva'
}

/**
 * ¿Se guarda `lista_espera.tutor_usuario_id` (D1)? Solo para el 2.º hijo de una familia de este
 * centro: es la pista EXACTA que evita depender de re-teclear el email al promover. La BD exige lo
 * mismo (`lista_espera_validar_tutor_trg`).
 */
export function guardaTutorUsuarioId(deteccion: DeteccionTutor): boolean {
  return deteccion === 'familia_existente'
}
