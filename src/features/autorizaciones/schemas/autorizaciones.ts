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

// Persona autorizada a recoger (recogida). DNI **laxo**: alfanumérico 5–20
// (acepta DNI/NIE/pasaporte de extranjeros); la foto va a F10.
export const personaAutorizadaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'autorizaciones.validation.persona_nombre_vacio')
    .max(200, 'autorizaciones.validation.persona_nombre_largo'),
  dni: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{5,20}$/, 'autorizaciones.validation.persona_dni_invalido'),
  parentesco: z
    .string()
    .trim()
    .max(100, 'autorizaciones.validation.persona_parentesco_largo')
    .optional(),
})
export type PersonaAutorizadaInput = z.input<typeof personaAutorizadaSchema>

export const personasAutorizadasSchema = z
  .array(personaAutorizadaSchema)
  .min(1, 'autorizaciones.validation.personas_vacio')
  .max(20, 'autorizaciones.validation.personas_muchas')

// Campos estructurados de una medicación (F8-3a). Van en `firmas.datos.medicacion`
// y se atan al hash compuesto. Las fechas definen la vigencia de la instancia
// (fecha_inicio → vigencia_desde, fecha_fin → vigencia_hasta). El informe/receta
// (adjunto) se aplaza a F10 (datos.adjuntos reservado).
export const medicacionDatosSchema = z
  .object({
    medicamento: z
      .string()
      .trim()
      .min(1, 'autorizaciones.validation.med_medicamento_vacio')
      .max(200, 'autorizaciones.validation.med_medicamento_largo'),
    dosis: z
      .string()
      .trim()
      .min(1, 'autorizaciones.validation.med_dosis_vacia')
      .max(200, 'autorizaciones.validation.med_dosis_larga'),
    via: z.string().trim().max(100, 'autorizaciones.validation.med_via_larga').optional(),
    pauta: z
      .string()
      .trim()
      .min(1, 'autorizaciones.validation.med_pauta_vacia')
      .max(300, 'autorizaciones.validation.med_pauta_larga'),
    fecha_inicio: fechaSchema,
    fecha_fin: fechaSchema,
  })
  .superRefine((v, ctx) => {
    if (v.fecha_fin < v.fecha_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['fecha_fin'],
        message: 'autorizaciones.validation.med_fechas_incoherentes',
      })
    }
  })
export type MedicacionDatosInput = z.input<typeof medicacionDatosSchema>

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
  // Recogida: lista de personas autorizadas (se ata al hash compuesto). Opcional
  // en el esquema (otros tipos no la llevan); el action la exige en recogida.
  personas: personasAutorizadasSchema.optional(),
  // Medicación: campos estructurados (al firmar una instancia existente, p.ej. el
  // 2.º tutor de un niño con doble firma). Se ata al hash compuesto.
  medicacion: medicacionDatosSchema.optional(),
})
export type FirmarAutorizacionInput = z.input<typeof firmarAutorizacionSchema>

// --- Recogida B2: la familia CREA su instancia desde la plantilla y la firma ---
// `modalidad`: habitual (vigencia abierta) | puntual (solo hoy). El action busca
// la plantilla de recogida publicada del centro del niño, crea/encuentra la
// instancia (tutor-insert acotado por RLS) y registra la firma con la lista.
export const modalidadRecogidaEnum = z.enum(['habitual', 'puntual'])
export type ModalidadRecogida = z.infer<typeof modalidadRecogidaEnum>

export const crearRecogidaSchema = z.object({
  nino_id: z.string().uuid('autorizaciones.validation.nino_requerido'),
  modalidad: modalidadRecogidaEnum,
  nombre_tecleado: z
    .string()
    .trim()
    .min(1, 'autorizaciones.validation.nombre_vacio')
    .max(200, 'autorizaciones.validation.nombre_largo'),
  firma_imagen: firmaImagenSchema,
  personas: personasAutorizadasSchema,
  comentario: comentarioSchema,
})
export type CrearRecogidaInput = z.input<typeof crearRecogidaSchema>

// --- Medicación B2: la familia CREA su instancia desde la plantilla y la firma -
// A diferencia de recogida (1 habitual), medicación admite **varias instancias
// activas** por niño (distintos tratamientos), cada una con su vigencia
// (fecha_inicio/fecha_fin). Sin modalidad. El action crea SIEMPRE una instancia
// nueva y registra la firma con los campos estructurados.
export const crearMedicacionSchema = z.object({
  nino_id: z.string().uuid('autorizaciones.validation.nino_requerido'),
  medicacion: medicacionDatosSchema,
  nombre_tecleado: z
    .string()
    .trim()
    .min(1, 'autorizaciones.validation.nombre_vacio')
    .max(200, 'autorizaciones.validation.nombre_largo'),
  firma_imagen: firmaImagenSchema,
  comentario: comentarioSchema,
})
export type CrearMedicacionInput = z.input<typeof crearMedicacionSchema>

// --- F8-3b: Registro de administración de medicación (doble confirmación) -----
// El staff (profe del aula / dirección) registra que ha administrado una dosis de
// una medicación FIRMADA + VIGENTE; un 2.º staff distinto la confirma. El snapshot
// medicamento/dosis y centro/niño los resuelve el server desde la instancia.
export const registrarAdministracionSchema = z.object({
  autorizacion_id: z.string().uuid(),
  notas: z
    .string()
    .trim()
    .max(500, 'autorizaciones.validation.adm_notas_largas')
    .nullable()
    .optional(),
})
export type RegistrarAdministracionInput = z.input<typeof registrarAdministracionSchema>

export const confirmarAdministracionSchema = z.object({
  administracion_id: z.string().uuid(),
})
export type ConfirmarAdministracionInput = z.input<typeof confirmarAdministracionSchema>

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
