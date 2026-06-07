import { z } from 'zod'

// Límites espejo de los CHECK de BD (20260603120000_phase8_autorizaciones.sql).
const tituloSchema = z
  .string()
  .trim()
  .min(1, 'autorizaciones.validation.titulo_vacio')
  .max(200, 'autorizaciones.validation.titulo_largo')

const textoSchema = z
  .string()
  .trim()
  .min(1, 'autorizaciones.validation.texto_vacio')
  .max(20000, 'autorizaciones.validation.texto_largo')

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'autorizaciones.validation.fecha_invalida')

const comentarioSchema = z
  .string()
  .trim()
  .max(500, 'autorizaciones.validation.comentario_largo')
  .nullable()
  .optional()

// --- Crear (tipo salida; cuelga de un evento) -------------------------------
// El `centro_id` y la política de firmantes los resuelve el server action.
export const crearAutorizacionSalidaSchema = z.object({
  evento_id: z.string().uuid('autorizaciones.validation.evento_requerido'),
  titulo: tituloSchema,
})

export type CrearAutorizacionSalidaInput = z.input<typeof crearAutorizacionSalidaSchema>

// --- Catálogo: crear PLANTILLA durable (reglas/imágenes/recogida/medicación) --
// Una plantilla es el FORMATO estándar del centro (no se firma; se envía a una
// audiencia —tipos A— o la rellena la familia —tipos B—). `salida` queda fuera
// (esa es bespoke por evento). Una activa por (centro, tipo) → idx único en BD.
export const tipoPlantillaEnum = z.enum([
  'reglas_regimen_interno',
  'autorizacion_imagenes',
  'recogida',
  'medicacion',
])
export type TipoPlantilla = z.infer<typeof tipoPlantillaEnum>

export const crearPlantillaSchema = z.object({
  tipo: tipoPlantillaEnum,
  titulo: tituloSchema,
})
export type CrearPlantillaInput = z.input<typeof crearPlantillaSchema>

// --- Enviar: asignar una plantilla A a una AUDIENCIA (niño/aula/centro) -------
// Solo tipos A (reglas/imágenes): recogida/medicación las inicia la familia y NO
// aparecen aquí. Crea una INSTANCIA firmable (snapshot del texto de la plantilla).
export const ambitoEnvioEnum = z.enum(['nino', 'aula', 'centro'])

export const enviarAutorizacionSchema = z
  .object({
    plantilla_id: z.string().uuid('autorizaciones.validation.plantilla_requerida'),
    ambito: ambitoEnvioEnum,
    nino_id: z.string().uuid().nullable().optional(),
    aula_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // Coherencia ámbito ↔ referencia (espejo del CHECK de BD, forma 3).
    if (v.ambito === 'nino' && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'autorizaciones.validation.nino_requerido',
      })
    }
    if (v.ambito === 'aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'autorizaciones.validation.aula_requerida',
      })
    }
    if (v.ambito === 'nino' && v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'autorizaciones.validation.audiencia_incoherente',
      })
    }
    if (v.ambito === 'aula' && v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'autorizaciones.validation.audiencia_incoherente',
      })
    }
    if (v.ambito === 'centro' && (v.nino_id || v.aula_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ambito'],
        message: 'autorizaciones.validation.audiencia_incoherente',
      })
    }
  })
export type EnviarAutorizacionInput = z.input<typeof enviarAutorizacionSchema>

// --- Editar texto (admin teclea el texto + lo marca definitivo) -------------
// El guard: solo un texto `texto_definitivo` puede publicarse/firmarse. El texto
// real (legal) lo pega el responsable; aquí permitimos un texto de prueba.
export const editarTextoAutorizacionSchema = z
  .object({
    autorizacion_id: z.string().uuid(),
    titulo: tituloSchema,
    texto: textoSchema,
    texto_definitivo: z.boolean(),
    vigencia_hasta: fechaSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // Guardia anti-placeholder: no marcar definitivo un texto que sigue siendo el
    // marcador. El hash debe ser de texto real.
    if (v.texto_definitivo && v.texto.trim().toUpperCase() === 'PENDIENTE') {
      ctx.addIssue({
        code: 'custom',
        path: ['texto'],
        message: 'autorizaciones.validation.texto_pendiente_no_definitivo',
      })
    }
  })

export type EditarTextoAutorizacionInput = z.input<typeof editarTextoAutorizacionSchema>

// --- Publicar / anular ------------------------------------------------------
export const publicarAutorizacionSchema = z.object({
  autorizacion_id: z.string().uuid(),
})
export type PublicarAutorizacionInput = z.input<typeof publicarAutorizacionSchema>

export const anularAutorizacionSchema = z.object({
  autorizacion_id: z.string().uuid(),
})
export type AnularAutorizacionInput = z.input<typeof anularAutorizacionSchema>

// --- Firmar (tutor) ---------------------------------------------------------
// `nombre_tecleado` = acto afirmativo (debe coincidir con el perfil, validado en
// el action). `firma_imagen` = trazo del canvas (data URL PNG base64), OBLIGATORIO
// al firmar (CHECK de BD). El hash y el contexto IP/UA los pone el server.
const firmaImagenSchema = z
  .string()
  .min(1, 'autorizaciones.validation.firma_requerida')
  .max(500000, 'autorizaciones.validation.firma_grande')
  .regex(/^data:image\/(png|svg\+xml);/, 'autorizaciones.validation.firma_formato')

export const firmarAutorizacionSchema = z.object({
  autorizacion_id: z.string().uuid(),
  nino_id: z.string().uuid(),
  nombre_tecleado: z
    .string()
    .trim()
    .min(1, 'autorizaciones.validation.nombre_vacio')
    .max(200, 'autorizaciones.validation.nombre_largo'),
  firma_imagen: firmaImagenSchema,
  comentario: comentarioSchema,
})
export type FirmarAutorizacionInput = z.input<typeof firmarAutorizacionSchema>

// --- Rechazar (tutor) — sin trazo (no hay firma que dibujar) ----------------
export const rechazarAutorizacionSchema = z.object({
  autorizacion_id: z.string().uuid(),
  nino_id: z.string().uuid(),
  comentario: comentarioSchema,
})
export type RechazarAutorizacionInput = z.input<typeof rechazarAutorizacionSchema>

// --- Revocar una firma previa (tutor) — fila nueva, append-only -------------
export const revocarFirmaSchema = z.object({
  autorizacion_id: z.string().uuid(),
  nino_id: z.string().uuid(),
  comentario: comentarioSchema,
})
export type RevocarFirmaInput = z.input<typeof revocarFirmaSchema>
