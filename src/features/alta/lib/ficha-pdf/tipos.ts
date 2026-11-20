import { z } from 'zod'

/**
 * La copia firmada de la ficha tal como la entrega `public.leer_ficha_firmada` (fase 10c): la foto
 * descifrada (`ficha`, la que da el sello) y lo de la firma que el PDF enseña. No la IP ni el
 * navegador.
 */
export const copiaFichaFirmadaSchema = z
  .object({
    firma_id: z.string().uuid(),
    nino_id: z.string().uuid(),
    firmado_at: z.string(),
    metodo_firma: z.enum(['digital', 'presencial']),
    rol_firmante: z.string(),
    nombre_tecleado: z.string(),
    firma_imagen: z.string().nullable(),
    ficha_version: z.number().int(),
    plantilla_pdf_version: z.number().int(),
    contenido_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    ficha: z.record(z.string(), z.unknown()),
  })
  .transform((r) => ({
    firmaId: r.firma_id,
    ninoId: r.nino_id,
    firmadoAt: r.firmado_at,
    metodoFirma: r.metodo_firma,
    rolFirmante: r.rol_firmante,
    nombreTecleado: r.nombre_tecleado,
    firmaImagen: r.firma_imagen,
    fichaVersion: r.ficha_version,
    plantillaPdfVersion: r.plantilla_pdf_version,
    contenidoSha256: r.contenido_sha256,
    ficha: r.ficha,
  }))

export type CopiaFichaFirmada = z.infer<typeof copiaFichaFirmadaSchema>
