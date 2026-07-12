import { z } from 'zod'

/**
 * F-2b-4-2 — "Añadir hijo a familia existente". Dirección selecciona una familia del
 * centro y solo introduce los datos del NIÑO + aula; los datos del tutor NO se re-teclean
 * (se leen de `familia_tutores`). Por eso el input lleva `familia_id` (no email/nombre de
 * tutor). La resolución del tutor (usuario_id + nombre_completo del titular) la hace el
 * server, no el cliente.
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
  aula_id: z.string().uuid('admin.admisiones.anadirHijo.validation.aula_requerida'),
})

export type AnadirHijoAFamiliaInput = z.infer<typeof anadirHijoAFamiliaSchema>
