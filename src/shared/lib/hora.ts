import { z } from 'zod'

/**
 * La hora de un formulario o de una acción: acepta 'HH:MM' y 'HH:MM:SS' y la deja en 'HH:MM'.
 *
 * La base devuelve las columnas `time` como 'HH:MM:SS'. Un esquema que solo acepta 'HH:MM' rechaza
 * cualquier hora que vuelva a la acción tal como se leyó: pasó en el pase de lista (medido el
 * 2026-11-13, `hora_invalida`). Agenda, citas y eventos tenían el mismo esquema y hoy ninguna pantalla
 * les reenvía una hora leída: protegidos por coincidencia. Desde el 2026-11-23 (C, «cierra la clase,
 * no el caso») todas usan este, y `hora.test.ts` se pone rojo si aparece otro.
 *
 * Recortar a 'HH:MM' también deja bien las comparaciones de los `superRefine` (fin > inicio), que
 * comparan cadenas: '10:00:00' contra '10:30' ya no se mezclan.
 */
export function horaSchema(mensaje: string) {
  return z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, mensaje)
    .transform((h) => h.slice(0, 5))
}
