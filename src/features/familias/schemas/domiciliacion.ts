import { z } from 'zod'

import { ibanValido } from '@/features/alta/lib/iban'

/**
 * F-2c-3 — validación del alta/sustitución PRESENCIAL de la domiciliación desde la ficha de
 * familia (Dirección). Mismos campos que el mandato del alta (IBAN + titular) + `familia_id`.
 * El IBAN se valida por estructura y dígitos de control (mód-97, `ibanValido`). No viaja PDF
 * ni trazo: el respaldo es el papel físico (`metodo_firma='presencial'`).
 */
export const domiciliacionFamiliaSchema = z.object({
  familia_id: z.string().uuid('admin.familias.domiciliacion.validation.familia'),
  iban: z
    .string()
    .min(15, 'admin.familias.domiciliacion.validation.iban')
    .max(34, 'admin.familias.domiciliacion.validation.iban')
    .refine(ibanValido, 'admin.familias.domiciliacion.validation.iban'),
  titular: z
    .string()
    .trim()
    .min(2, 'admin.familias.domiciliacion.validation.titular')
    .max(140, 'admin.familias.domiciliacion.validation.titular'),
})

export type DomiciliacionFamiliaInput = z.infer<typeof domiciliacionFamiliaSchema>
