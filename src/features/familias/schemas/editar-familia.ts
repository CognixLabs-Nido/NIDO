import { z } from 'zod'

// F-6a — edición desde la ficha de familia (Dirección).

/** Etiqueta de la familia (1–200, coincide con el CHECK `familias.etiqueta`). */
export const editarEtiquetaFamiliaSchema = z.object({
  familia_id: z.string().uuid(),
  etiqueta: z
    .string()
    .trim()
    .min(1, 'admin.familias.validation.etiqueta_requerida')
    .max(200, 'admin.familias.validation.etiqueta_larga'),
})
export type EditarEtiquetaFamiliaInput = z.infer<typeof editarEtiquetaFamiliaSchema>

/**
 * Perfil editable de un tutor: SOLO identidad + dirección. `usuario_id`/`rol_familia`/
 * `familia_id` NO se incluyen (los congela el trigger `familia_tutores_proteger_usuario_id`);
 * `dni_documento_path` se gestiona aparte (subida del DNI). Longitudes espejo de la BD.
 */
export const editarPerfilTutorSchema = z.object({
  tutor_id: z.string().uuid(),
  nombre_completo: z
    .string()
    .trim()
    .min(1, 'admin.familias.validation.nombre_requerido')
    .max(200, 'admin.familias.validation.nombre_largo')
    .nullable(),
  email: z.string().trim().email('admin.familias.validation.email').max(255).nullable(),
  direccion_calle: z.string().trim().max(200).optional().nullable(),
  direccion_numero: z.string().trim().max(20).optional().nullable(),
  direccion_cp: z.string().trim().max(12).optional().nullable(),
  direccion_ciudad: z.string().trim().max(120).optional().nullable(),
})
export type EditarPerfilTutorInput = z.infer<typeof editarPerfilTutorSchema>
