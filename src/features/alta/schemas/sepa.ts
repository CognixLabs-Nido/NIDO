import { z } from 'zod'

import { ibanValido } from '../lib/iban'

/**
 * F11-G-2 — validación del formulario del mandato SEPA (IBAN + titular). El IBAN se valida
 * por estructura y dígitos de control (mód-97). La firma (trazo), el identificador y el PDF
 * NO viajan aquí: la ruta de subida (`/alta/[ninoId]/mandato-sepa`) los recibe en el FormData
 * y los valida por separado (espejo de las rutas de documentos de G-1).
 */
export const sepaMandatoFormSchema = z.object({
  iban: z
    .string()
    .min(15, 'alta.sepa.errors.iban')
    .max(34, 'alta.sepa.errors.iban')
    .refine(ibanValido, 'alta.sepa.errors.iban'),
  titular: z.string().min(2, 'alta.sepa.errors.titular').max(140, 'alta.sepa.errors.titular'),
})

export type SepaMandatoFormInput = z.infer<typeof sepaMandatoFormSchema>
