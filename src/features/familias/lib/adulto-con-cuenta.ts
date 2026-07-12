/**
 * F-2b-4-2 — elegir el adulto CON CUENTA de una familia para enrutar el alta del 2º hijo
 * a `crear_o_anadir_a_familia` con su `usuario_id` real.
 *
 * Regla: preferir el TITULAR con cuenta; si el titular no tiene cuenta (invitación
 * pendiente) pero un `segundo_tutor` sí, usar ese. Si NINGÚN adulto tiene `usuario_id`,
 * la familia NO es elegible para este flujo (devuelve `null` → el caller la rechaza / la
 * query la excluye del selector).
 *
 * `nombreCompleto` se devuelve EXACTAMENTE como está guardado en `familia_tutores`: se pasa
 * tal cual a la RPC como `p_tutor_nombre_completo` para que el chequeo de colisión por
 * nombre sea inerte por construcción (coincide con el valor almacenado).
 */
export interface TutorFamiliaMinimo {
  usuario_id: string | null
  nombre_completo: string | null
  email: string | null
  rol_familia: string
}

export interface AdultoConCuenta {
  usuarioId: string
  nombreCompleto: string | null
  email: string | null
}

export function elegirAdultoConCuenta(tutores: TutorFamiliaMinimo[]): AdultoConCuenta | null {
  const conCuenta = tutores.filter((t) => t.usuario_id !== null)
  if (conCuenta.length === 0) return null
  // Preferir el titular con cuenta; si no, el primer adulto con cuenta (segundo_tutor).
  const elegido = conCuenta.find((t) => t.rol_familia === 'titular') ?? conCuenta[0]!
  return {
    usuarioId: elegido.usuario_id!,
    nombreCompleto: elegido.nombre_completo,
    email: elegido.email,
  }
}
