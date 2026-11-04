import { z } from 'zod'

import { ibanValido } from '@/features/alta/lib/iban'
import { documentoValido } from '@/features/alta/lib/documento-identidad'

/**
 * F-2c-3 — validación del alta/sustitución PRESENCIAL de la domiciliación desde la ficha de
 * familia (Dirección). Mismos campos que el mandato del alta (IBAN, titular, su documento y su
 * dirección) + `familia_id`.
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
  // 0c-2: «NIF o documento de identidad» (el dígito de control, solo con forma española) y la
  // dirección del titular, del mandato en papel.
  titular_documento: z
    .string()
    .trim()
    .refine(documentoValido, 'admin.familias.domiciliacion.validation.documento'),
  titular_direccion: z
    .string()
    .trim()
    .min(5, 'admin.familias.domiciliacion.validation.direccion')
    .max(300, 'admin.familias.domiciliacion.validation.direccion'),
})

export type DomiciliacionFamiliaInput = z.infer<typeof domiciliacionFamiliaSchema>
