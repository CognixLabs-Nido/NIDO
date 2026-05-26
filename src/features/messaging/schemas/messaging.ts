import { z } from 'zod'

// --- ENUMs --------------------------------------------------------------------
export const ambitoAnuncioEnum = z.enum(['aula', 'centro'])
export type AmbitoAnuncio = z.infer<typeof ambitoAnuncioEnum>

// --- Helpers comunes ----------------------------------------------------------
// Trim + límites. El CHECK BD permite 11 chars extra (margen para el prefijo
// `[anulado] ` que mide 10 caracteres + 1 colchón defensivo). El límite Zod
// del input REAL es 2000 (mensaje) y 200 (título), siempre sin contar el
// prefijo: el server action lo añade al marcar erróneo.
const contenidoMensajeSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.contenido_vacio')
  .max(2000, 'messages.validation.contenido_largo')

const tituloAnuncioSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.titulo_vacio')
  .max(200, 'messages.validation.titulo_largo')

const contenidoAnuncioSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.contenido_vacio')
  .max(4000, 'messages.validation.contenido_largo_anuncio')

// --- Mensaje ------------------------------------------------------------------
// Input del server action enviar-mensaje(ninoId, contenido). El server action
// localiza/crea la conversación a partir de nino_id (auto-creación lazy).
export const mensajeInputSchema = z.object({
  nino_id: z.string().uuid(),
  contenido: contenidoMensajeSchema,
})
export type MensajeInput = z.infer<typeof mensajeInputSchema>

// --- Anuncio ------------------------------------------------------------------
// Input del server action publicar-anuncio. Cross-field:
//  - ambito='aula'   ⇒ aula_id requerida
//  - ambito='centro' ⇒ aula_id null
// La validación del centro_id (que coincida con el centro del aula y con el
// centro del usuario autenticado) la hace el server action + RLS WITH CHECK.
export const anuncioInputSchema = z
  .object({
    ambito: ambitoAnuncioEnum,
    aula_id: z.string().uuid().nullable(),
    titulo: tituloAnuncioSchema,
    contenido: contenidoAnuncioSchema,
  })
  .superRefine((v, ctx) => {
    if (v.ambito === 'aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'messages.validation.aula_requerida',
      })
    }
    if (v.ambito === 'centro' && v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'messages.validation.aula_no_aplica_centro',
      })
    }
  })
export type AnuncioInput = z.infer<typeof anuncioInputSchema>

// --- Marcado como leído / erróneo --------------------------------------------
export const marcarConversacionLeidaSchema = z.object({
  conversacion_id: z.string().uuid(),
})

export const marcarAnuncioLeidoSchema = z.object({
  anuncio_id: z.string().uuid(),
})

export const marcarMensajeErroneoSchema = z.object({
  mensaje_id: z.string().uuid(),
})

export const marcarAnuncioErroneoSchema = z.object({
  anuncio_id: z.string().uuid(),
})

// --- Constantes y helpers de "marcar como erróneo" ---------------------------
// Mismo patrón que F3/F4 (PREFIX_ANULADO en agenda; '[cancelada] ' en
// ausencias). En F5 además hay flag boolean `erroneo` en la fila; el prefijo
// es defensa en profundidad y guía visual.
export const PREFIX_ANULADO = '[anulado] '

export function esMensajeAnulado(m: { erroneo: boolean; contenido: string }): boolean {
  return m.erroneo || m.contenido.startsWith(PREFIX_ANULADO)
}

export function esAnuncioAnulado(a: { erroneo: boolean; titulo: string }): boolean {
  return a.erroneo || a.titulo.startsWith(PREFIX_ANULADO)
}
