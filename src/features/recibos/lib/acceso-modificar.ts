// R-5: ¿se puede MODIFICAR (desconfirmar → editar → reconfirmar) un recibo ya confirmado?
// Decisión pura, sin Supabase, para que la UI y la action digan exactamente lo mismo: la
// primera pinta el botón (habilitado o deshabilitado con su motivo) y la segunda rechaza.
// Si cada una razonara por su cuenta acabaríamos con un botón que invita a algo que el
// servidor luego niega — que es la peor forma de comunicar una regla.

import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']

/**
 * Por qué NO se puede modificar:
 *  · `en_remesa`      — ya está en una remesa creada (la salvaguarda de Jose). El fichero
 *                       SEPA ha podido salir hacia el banco; el recibo deja de ser nuestro.
 *  · `cobro_avanzado` — el ciclo de cobro pasó de la confirmación (cobrado a mano, enviado
 *                       al banco, devuelto). El dinero ya se movió.
 *  · `no_confirmado`  — es un borrador: no hay nada que desconfirmar, se edita directamente.
 */
export type MotivoBloqueo = 'en_remesa' | 'cobro_avanzado' | 'no_confirmado'

export type AccesoModificar = { permitido: true } | { permitido: false; motivo: MotivoBloqueo }

/**
 * `en_remesa` se comprueba ANTES que el estado a propósito: un recibo remesado y ya enviado
 * al banco incumple las dos reglas, y de las dos la que la directora entiende es "está en
 * una remesa" — es la que ella misma creó y puede ir a mirar. "El cobro ya avanzó" solo se
 * dice cuando es la única razón, es decir, cuando el cobro fue por fuera de SEPA.
 */
export function accesoModificar(estado: EstadoRecibo, enRemesa: boolean): AccesoModificar {
  if (estado === 'borrador') return { permitido: false, motivo: 'no_confirmado' }
  if (enRemesa) return { permitido: false, motivo: 'en_remesa' }
  if (estado !== 'pendiente_procesar') return { permitido: false, motivo: 'cobro_avanzado' }
  return { permitido: true }
}
