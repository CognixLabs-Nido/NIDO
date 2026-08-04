import { z } from 'zod'

/**
 * U-2 (alta unificada) — "Añadir hijo a familia existente" crea un PROSPECTO en la lista de
 * espera, no el niño. Dirección elige una familia del centro y teclea solo los datos del
 * NIÑO; los del tutor NO se re-teclean (se leen de `familia_tutores`, y su `usuario_id` se
 * guarda en el prospecto — D1). Por eso el input lleva `familia_id`.
 *
 * Frente a F-2b-4-2 desaparecen dos campos, porque ya no se decide nada de eso aquí:
 *  - `aula_id`: el aula se elige al PROMOVER (Invitar/Completar), que es cuando nace la
 *    matrícula. Pedirla ahora sería guardar un dato que nadie lee.
 *  - `parentesco`/`descripcion_parentesco`: al promover, `vincularHijoATutorExistente` lo
 *    hereda del vínculo previo del tutor (mismo criterio de siempre, D-4 punto 3).
 */
export const anadirHijoAFamiliaSchema = z.object({
  familia_id: z.string().uuid(),
  nombre: z
    .string()
    .trim()
    .min(1, 'admin.admisiones.anadirHijo.validation.nombre_requerido')
    .max(120),
  apellidos: z
    .string()
    .trim()
    .min(1, 'admin.admisiones.anadirHijo.validation.apellidos_requerido')
    .max(120),
  fecha_nacimiento: z.string().min(1, 'admin.admisiones.anadirHijo.validation.fecha_requerida'),
})

export type AnadirHijoAFamiliaInput = z.infer<typeof anadirHijoAFamiliaSchema>
