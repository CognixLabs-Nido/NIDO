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
// Input del server action `enviarMensaje`. Union discriminada por `kind`:
//
//   - `profe_familia` (legacy F5): direcciona por `nino_id`. La conversación
//     se localiza/crea lazy a partir del niño. `kind` es OPCIONAL y por defecto
//     `'profe_familia'`, así que los callers F5 que pasan `{ nino_id, contenido }`
//     siguen funcionando sin tocar nada.
//   - `admin_familia` (F5.6-A): direcciona por `conversacion_id`. La
//     conversación SIEMPRE existe previamente (la abrió el admin con
//     `abrirConversacionAdminFamilia`). `kind` es REQUERIDO.
//
// Usamos `z.union` (no `discriminatedUnion`) porque la rama profe_familia
// admite ausencia del discriminante por compatibilidad. Internamente Zod
// prueba la primera shape y luego la segunda; ambas son disjuntas en sus
// campos identificativos (`nino_id` vs `conversacion_id`), así que no hay
// ambigüedad.
const mensajeInputProfeFamiliaSchema = z.object({
  kind: z.literal('profe_familia').optional().default('profe_familia'),
  nino_id: z.string().uuid(),
  contenido: contenidoMensajeSchema,
})

const mensajeInputAdminFamiliaSchema = z.object({
  kind: z.literal('admin_familia'),
  conversacion_id: z.string().uuid(),
  contenido: contenidoMensajeSchema,
})

export const mensajeInputSchema = z.union([
  mensajeInputProfeFamiliaSchema,
  mensajeInputAdminFamiliaSchema,
])

// `MensajeInput` es el tipo de ENTRADA (pre-defaults). Permite que callers
// pasen `{ nino_id, contenido }` sin `kind` (legacy F5). El tipo PARSED
// (`z.output`) lleva siempre `kind` definido y se usa internamente en el
// action core para la rama if/else.
export type MensajeInput = z.input<typeof mensajeInputSchema>
export type MensajeInputParsed = z.output<typeof mensajeInputSchema>

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

// --- F5.6-A — Abrir/reabrir conversación admin ↔ familia ---------------------
// Input mínimo: el `tutor_id` con el que se quiere hablar. El `admin_id`,
// `centro_id` y `expires_at` los resuelve el server action a partir de la
// sesión y de la migración (3 días desde now()).
export const abrirConversacionAdminFamiliaSchema = z.object({
  tutor_id: z.string().uuid(),
})
export type AbrirConversacionAdminFamiliaInput = z.infer<typeof abrirConversacionAdminFamiliaSchema>

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
