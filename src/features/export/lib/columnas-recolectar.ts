import type { Database } from '@/types/db'

/**
 * La red del export art. 15, la mitad de la app: lo que `recolectar.ts` lee con la sesión de quien
 * exporta y entrega tal cual. Cada columna de cada tabla que lee está decidida aquí, una por una, y
 * la consulta pide solo las columnas que salen (`columnasDe`): una columna nueva en la base no sale
 * hasta que alguien la decida. Hasta el 2026-11-01 eran `select('*')`, y salía todo lo que la tabla
 * tuviera, también lo que se añadiera después.
 *
 *  - `sale`: sale, con su nombre de columna (la app no renombra).
 *  - `noSale`: no sale A PROPÓSITO, y el texto es el porqué. Lo lee quien revise el export (un
 *    abogado incluido): tiene que ser verdad y entenderse sin abrir el código.
 *  - `saleSinRepasar`: sale porque el `select('*')` la sacaba, y nadie la ha repasado todavía. Es
 *    lo que había el 2026-11-01, y solo puede menguar: una columna nueva no entra aquí (lo vigila
 *    el test con la lista fechada). El repaso con su porqué es el trozo 2 de la red.
 *
 * El tipo obliga a decidir: cada sección es un `Record` sobre las columnas de su tabla en
 * `Database`, y una columna nueva en los tipos no compila hasta estar aquí. Los tests comprueban,
 * además, que `recolectar.ts` pide a cada tabla exactamente estas columnas
 * (`columnas-recolectar.test.ts`) y que son las columnas vivas de la base
 * (`export-columnas.rls.test.ts`): los tipos se escriben a veces a mano.
 *
 * Lo que sale de `export_datos_sujeto` (la otra mitad) está en `columnas-export.ts`.
 */

type Tablas = Database['public']['Tables']

/**
 * - `sale`: sale, con su nombre de columna (la app no renombra).
 * - `noSale`: no sale, con su porqué. Con `seLee`, se pide igual porque el código la usa (y el
 *   texto dice para qué), pero se quita antes de entregar.
 * - `rol`: el uuid de una persona no sale; se pide para dar, con la clave `rol`, su rol en la fecha
 *   de la columna `fecha` (`roles-a-la-fecha.ts`), y se quita antes de entregar.
 * - `enSuLugar`: el id no sale (R5); se pide para dar, con la clave `enSuLugar`, lo que la persona
 *   reconoce de esa fila (`dice`: el nombre del niño, el título del documento…), y se quita antes de
 *   entregar. `recolectar.ts` no compila sin dar ese valor (`entregadas`).
 * - `saleSinRepasar`: lo que el `select('*')` sacaba el 2026-11-01 sin repasar (la lista fechada).
 */
export type DecisionColumnaApp =
  | { sale: true }
  | { noSale: string; seLee?: string }
  | { rol: string; fecha: string }
  | { enSuLugar: string; dice: string }
  | { saleSinRepasar: true }

type Columnas<T extends keyof Tablas> = keyof Tablas[T]['Row'] & string

function seccion<T extends keyof Tablas, const C extends Record<Columnas<T>, DecisionColumnaApp>>(
  tabla: T,
  columnas: C & Record<Exclude<keyof C, Columnas<T>>, never>
) {
  return { tabla, columnas: columnas as C }
}

const SSR = { saleSinRepasar: true } as const

/*
 * 2c, decisión del responsable del 2026-11-02: con R5 el export del usuario ya no decía a qué se
 * refería cada fila (de qué niño, qué documento firmó, a qué cita respondió), y entregarlo así era
 * peor que antes. En lugar del id va lo que la persona reconoce. El niño, con su nombre: es su hijo,
 * y la familia del propio niño va con nombre (la raya del 2026-11-01).
 */
const NINO_POR_NOMBRE = {
  enSuLugar: 'nino',
  dice: 'el nombre y los apellidos del niño (vacío si la fila no es de ningún niño)',
} as const

/** 2c (2026-11-02): las dos versiones que `usuarios` guarda como caché. */
const NS_VERSION_CONSENTIMIENTO = {
  noSale:
    '2c (2026-11-02): es una copia de la última versión aceptada de los términos o de la privacidad, que la app guarda para no consultarla cada vez. Sale completa en `usuario.consentimientos`: una fila por cada versión aceptada (`tipo`, `version`), con cuándo se aceptó y, si fue así, cuándo se revocó.',
} as const

/*
 * Las reglas del trozo 2 de la red (decididas por el responsable el 2026-11-01; son interpretación
 * del art. 15 RGPD, no producto). Cada columna técnica se decide por su clase, con este porqué.
 *
 * R1 · Las fechas de registro (`created_at`, `updated_at`) salen siempre: cuándo se registró o
 *      cambió un dato de la persona es información sobre el tratamiento de sus datos (art. 15.1).
 * R2 · `deleted_at` sale; `deleted_reason`, solo en las filas de la propia persona (`NS_MOTIVO_OTROS`).
 * R3 · `centro_id` no sale (`NS_CENTRO`).
 * R4 · El uuid de una persona no sale (`NS_PERSONA`). En seis sitios, decisión de Jose del
 *      2026-11-01, sale en su lugar el rol de quien lo hizo a esa fecha (`rol`), nunca el nombre.
 * R5 · Un id o un enlace sale solo si une dos cosas que el propio export entrega (`NS_ID`,
 *      `NS_FUERA`, `NS_SUJETO`, `NS_ANIDADA` cuando no).
 * R6 · Las claves (de notificaciones, de invitación) no salen: en esta mitad no hay ninguna.
 * R7 · La huella técnica de una firma sale (`texto_hash`, `texto_version`, `metodo_firma`); la IP y
 *      el navegador, solo en las firmas de la propia persona (`NS_IP_OTROS`).
 */
const SALE = { sale: true } as const

const NS_CENTRO = {
  noSale:
    'R3 (2026-11-01): el centro es el responsable del tratamiento, no un dato de la persona; quién es lo dice el aviso de privacidad.',
} as const

const NS_PERSONA = {
  noSale:
    'R4 (2026-11-01): clave interna (uuid) de otra persona. A quien recibe el export no le dice nada legible, y es un dato de esa otra persona.',
} as const

const NS_SUJETO = {
  noSale:
    'R5 (2026-11-01): apunta a la persona interesada del propio export (o al niño, en el del niño): todas estas filas son suyas, así que no une nada.',
} as const

const NS_ID = {
  noSale:
    'R5 (2026-11-01): clave interna de la fila. Ninguna otra fila del export la nombra, así que no une nada de lo que la persona recibe.',
} as const

const NS_FUERA = {
  noSale:
    'R5 (2026-11-01): apunta a una fila que este export no entrega, así que no une nada de lo que la persona recibe.',
} as const

const NS_ANIDADA = {
  noSale:
    'R5 (2026-11-01): la fila ya sale dentro de su agenda del día: la anidación las une, y la clave no añade nada.',
} as const

const NS_MOTIVO_OTROS = {
  noSale:
    'R2 (2026-11-01): en el export del niño que descarga Dirección salen los vínculos de todos los adultos del niño, también los retirados, y el motivo de retirada de otro adulto (por ejemplo, que pidió el olvido) es un dato de esa persona (art. 15.4 RGPD). El tutor que descarga el suyo solo ve su vínculo, con su motivo en `usuario.vinculos_familiares`.',
} as const

const NS_IP_OTROS = {
  noSale:
    'R7 (2026-11-01): la IP y el navegador desde los que se firmó son datos de quien firmó, y aquí salen también las firmas del otro tutor del niño. Las de la propia persona salen en `usuario.firmas_realizadas`.',
} as const

/*
 * 2d, decisiones del responsable del 2026-11-01 (contenido del niño): todo lo del niño sale, también
 * las notas de Dirección (`notas_admin`: una nota sobre una persona identificada es dato suyo aunque
 * sea una opinión, y la pantalla lo avisa). Lo que no sale es de otro adulto del niño: sus permisos,
 * y de sus firmas, la imagen y los datos.
 */
const NS_PERMISOS_OTROS = {
  noSale:
    '2d, decisión del responsable del 2026-11-01: los permisos de cada adulto (ver la ficha médica, recibir mensajes…) son de ese adulto, no del niño; quién está vinculado y como qué, sí sale. Los permisos de la propia persona salen en `usuario.vinculos_familiares` (`permisos`).',
} as const

const NS_IMAGEN_FIRMA_OTROS = {
  noSale:
    '2d, decisión del responsable del 2026-11-01: aquí salen también las firmas del otro tutor del niño, y la imagen de una firma se copia (el patrón de R7). Qué firmó, cuándo, con qué decisión y con qué nombre tecleado sí sale. Las firmas de la propia persona salen con su imagen en `usuario.firmas_realizadas` (`firma_imagen`).',
} as const

const NS_DATOS_FIRMA_OTROS = {
  noSale:
    '2d, decisión del responsable del 2026-11-01: en una autorización de recogida, los datos son las personas que el firmante autoriza a recoger al niño y las fotos de su DNI; aquí salen también las firmas del otro tutor, y son terceros que nombró esa otra persona. Los de la propia persona salen en `usuario.firmas_realizadas` (`datos`).',
} as const

const NS_COMENTARIO_FIRMA_OTROS = {
  noSale:
    '2d, decisión del responsable del 2026-11-02, con la misma regla que la imagen y los datos de recogida: aquí salen también las firmas del otro tutor, y el comentario es texto que escribió esa otra persona, sin forma de saber si habla del niño o de ella. No se retiene porque sea secreto, sino porque es contenido de otra persona, y esa persona lo recibe entero en su propio export. El de la propia persona sale en `usuario.firmas_realizadas` (`comentario`).',
} as const

/*
 * Las firmas de los documentos del centro (serie de altas, 3b, 2026-11-05) siguen las mismas reglas
 * que las de autorizaciones (R7 y 2d): del otro tutor no salen su IP, su navegador ni la imagen de su
 * firma. Lo firmado sale por su copia en la fila (título, número, curso y huella), porque la versión
 * y el documento no se exportan.
 */
const NS_IP_DOC_OTROS = {
  noSale:
    'R7 (2026-11-01), en las firmas de los documentos del centro (3b): la IP y el navegador desde los que se firmó son datos de quien firmó, y aquí salen también las firmas del otro tutor del niño. Las de la propia persona salen en `usuario.firmas_documentos_realizadas`.',
} as const

const NS_IMAGEN_DOC_OTROS = {
  noSale:
    '2d (2026-11-01), en las firmas de los documentos del centro (3b): aquí salen también las firmas del otro tutor del niño, y la imagen de una firma se copia. Qué firmó, cuándo y con qué nombre tecleado sí sale. Las firmas de la propia persona salen con su imagen en `usuario.firmas_documentos_realizadas` (`firma_imagen`).',
} as const

const NS_DOCUMENTO_COPIADO = {
  noSale:
    'R5 (2026-11-01): apunta a la versión o al documento del centro, que este export no entrega. Lo firmado sale por la copia que guarda la propia firma: `titulo`, `numero`, `curso_nombre` y `sha256`.',
} as const

/** Quién está vinculado al niño (2d): un adulto de su familia, con su nombre (la raya del 2026-11-01). */
const ADULTO_POR_NOMBRE = {
  enSuLugar: 'adulto',
  dice: 'el nombre del adulto vinculado al niño: es de su familia, y la familia del propio niño va con nombre',
} as const

/**
 * Por qué sale el rol y no el nombre (R4), decisión de Jose del 2026-11-01: el nombre de la
 * trabajadora es dato de la trabajadora, y el export es un fichero que la familia descarga y puede
 * reenviar a cualquier sitio (art. 15.4 RGPD). Dentro de la app, Dirección sigue viendo el nombre.
 * De dónde sale cada rol, en `roles-a-la-fecha.ts`.
 */
export const POR_QUE_EL_ROL =
  'R4, decisión de Jose del 2026-11-01: en el export va el rol de quien lo hizo a esa fecha, no su nombre. El nombre de la trabajadora es dato de la trabajadora, y el export es un fichero que la familia descarga y puede reenviar a cualquier sitio (art. 15.4 RGPD).'

/** Por ruta: `usuario.` o `nino.` y la clave del export (y la de dentro, si la hay). */
export const SECCIONES_RECOLECTAR = {
  'usuario.ficha': seccion('usuarios', {
    consentimiento_privacidad_version: NS_VERSION_CONSENTIMIENTO,
    consentimiento_terminos_version: NS_VERSION_CONSENTIMIENTO,
    created_at: SALE,
    deleted_at: SALE,
    foto_url: SALE,
    id: NS_ID,
    idioma_preferido: SALE,
    nombre_completo: SALE,
    updated_at: SALE,
  }),
  'usuario.roles': seccion('roles_usuario', {
    centro_id: { ...NS_CENTRO, seLee: 'para el registro del export (`export_log.centro_id`)' },
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    id: NS_ID,
    rol: SALE,
    usuario_id: NS_SUJETO,
  }),
  'usuario.consentimientos': seccion('consentimientos', {
    aceptado_en: SALE,
    created_at: SALE,
    id: NS_ID,
    ip_address: SALE,
    metodo_firma: SALE,
    nino_id: NINO_POR_NOMBRE,
    revocado_en: SALE,
    tipo: SALE,
    user_agent: SALE,
    usuario_id: NS_SUJETO,
    version: SALE,
  }),
  'usuario.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    descripcion_parentesco: SALE,
    id: NS_ID,
    nino_id: NINO_POR_NOMBRE,
    parentesco: SALE,
    permisos: SALE,
    tipo_vinculo: SALE,
    updated_at: SALE,
    usuario_id: NS_SUJETO,
  }),
  'usuario.mensajes': seccion('mensajes', {
    autor_id: { rol: 'autor_rol', fecha: 'created_at' },
    contenido: SALE,
    conversacion_id: {
      noSale:
        '2c (2026-11-02): los mensajes salen agrupados por conversación, y cada conversación dice con quién es, por su rol («Dirección» o «el profesorado del aula»), y de qué niño, con su nombre. La agrupación ya los une: la clave no añade nada.',
      seLee: 'para agrupar los mensajes por conversación y dar el rol a la fecha del autor',
    },
    created_at: SALE,
    erroneo: SALE,
    id: NS_ID,
    updated_at: SALE,
  }),
  'usuario.ausencias_reportadas': seccion('ausencias', {
    created_at: SALE,
    descripcion: SALE,
    fecha_fin: SALE,
    fecha_inicio: SALE,
    id: NS_ID,
    motivo: SALE,
    nino_id: NINO_POR_NOMBRE,
    reportada_por: NS_SUJETO,
    updated_at: SALE,
  }),
  'usuario.invitaciones_a_citas': seccion('cita_invitados', {
    centro_id: NS_CENTRO,
    cita_id: { enSuLugar: 'cita', dice: 'el título y la fecha de la cita' },
    comentario: SALE,
    created_at: SALE,
    estado: SALE,
    id: NS_ID,
    nombre_externo: {
      noSale:
        '2c (2026-11-02): en las filas de una persona con cuenta va siempre vacío (CHECK `cita_invitados_persona_coherencia`: o la cuenta o un nombre externo, nunca los dos). El nombre de la persona sale en `usuario.ficha` (`nombre_completo`).',
    },
    respondido_at: SALE,
    respondido_por: NS_PERSONA,
    updated_at: SALE,
    usuario_id: NS_SUJETO,
  }),
  'usuario.recordatorios_recibidos': seccion('recordatorios', {
    aula_id: NS_FUERA,
    centro_id: { ...NS_CENTRO, seLee: 'para dar el rol a la fecha de quien lo creó, en su centro' },
    completado_en: SALE,
    completado_por: NS_PERSONA,
    creado_por: { rol: 'creado_por_rol', fecha: 'created_at' },
    created_at: SALE,
    descripcion: SALE,
    destinatario: SALE,
    erroneo: SALE,
    id: NS_ID,
    nino_id: {
      noSale:
        '2c (2026-11-02): en estas filas va siempre vacío. Son los recordatorios dirigidos a la persona (a ella como profesora, o los que se puso ella misma), y un recordatorio con persona destinataria no lleva niño (CHECK `recordatorios_destino_coherencia`). Los recordatorios a la familia sobre un niño salen en el export del niño (`recordatorios`).',
    },
    titulo: SALE,
    updated_at: SALE,
    usuario_destinatario_id: NS_SUJETO,
    vencimiento: SALE,
  }),
  'usuario.firmas_realizadas': seccion('firmas_autorizacion', {
    autorizacion_id: { enSuLugar: 'documento', dice: 'el título y el tipo del documento firmado' },
    comentario: SALE,
    created_at: SALE,
    datos: SALE,
    decision: SALE,
    firma_imagen: SALE,
    firmado_at: SALE,
    firmante_id: NS_SUJETO,
    id: NS_ID,
    ip_address: SALE,
    metodo_firma: SALE,
    nino_id: NINO_POR_NOMBRE,
    nombre_tecleado: SALE,
    rol_firmante: SALE,
    texto_hash: SALE,
    texto_version: SALE,
    user_agent: SALE,
  }),
  'usuario.firmas_documentos_realizadas': seccion('firmas_documentos_centro', {
    centro_id: NS_CENTRO,
    curso_academico_id: NS_DOCUMENTO_COPIADO,
    curso_nombre: SALE,
    documento_id: NS_DOCUMENTO_COPIADO,
    firma_imagen: SALE,
    firmado_at: SALE,
    firmante_id: NS_SUJETO,
    id: NS_ID,
    ip_address: SALE,
    metodo_firma: SALE,
    nino_id: NINO_POR_NOMBRE,
    nombre_tecleado: SALE,
    numero: SALE,
    rol_firmante: SALE,
    sha256: SALE,
    titulo: SALE,
    user_agent: SALE,
    version_id: NS_DOCUMENTO_COPIADO,
  }),
  'nino.ficha': seccion('ninos', {
    apellidos: SALE,
    centro_id: { ...NS_CENTRO, seLee: 'para el registro del export (`export_log.centro_id`)' },
    como_nos_conocio: SALE,
    como_nos_conocio_otro: SALE,
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    direccion_calle: SALE,
    direccion_ciudad: SALE,
    direccion_cp: SALE,
    direccion_numero: SALE,
    direccion_provincia: SALE,
    dni: SALE,
    estado_civil_familia: SALE,
    familia_id: NS_FUERA,
    fecha_nacimiento: SALE,
    foto_url: SALE,
    hermanos_lugar: SALE,
    hermanos_total: SALE,
    id: NS_ID,
    idioma_principal: SALE,
    libro_familia_path: SALE,
    lugar_nacimiento: SALE,
    nacionalidad: SALE,
    nombre: SALE,
    notas_admin: SALE,
    observaciones_familia: SALE,
    primer_apellido: SALE,
    puede_aparecer_en_fotos: SALE,
    purgado_en: SALE,
    requiere_ambos_firmantes: SALE,
    segundo_apellido: SALE,
    sexo: SALE,
    updated_at: SALE,
  }),
  'nino.datos_pedagogicos': seccion('datos_pedagogicos_nino', {
    alimentacion_observaciones: SALE,
    control_esfinteres: SALE,
    control_esfinteres_observaciones: SALE,
    created_at: SALE,
    deleted_at: SALE,
    id: NS_ID,
    idiomas_casa: SALE,
    lactancia_estado: SALE,
    lactancia_observaciones: SALE,
    nino_id: NS_SUJETO,
    siesta_horario_habitual: SALE,
    siesta_numero_diario: SALE,
    siesta_observaciones: SALE,
    tiene_hermanos_en_centro: SALE,
    tipo_alimentacion: SALE,
    updated_at: SALE,
  }),
  'nino.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: NS_MOTIVO_OTROS,
    descripcion_parentesco: SALE,
    id: NS_ID,
    nino_id: NS_SUJETO,
    parentesco: SALE,
    permisos: NS_PERMISOS_OTROS,
    tipo_vinculo: SALE,
    updated_at: SALE,
    usuario_id: ADULTO_POR_NOMBRE,
  }),
  'nino.agendas_diarias': seccion('agendas_diarias', {
    created_at: SALE,
    estado_general: SALE,
    fecha: SALE,
    humor: SALE,
    id: NS_ID,
    nino_id: NS_SUJETO,
    observaciones_generales: SALE,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.comidas': seccion('comidas', {
    agenda_id: NS_ANIDADA,
    cantidad: SALE,
    created_at: SALE,
    descripcion: SALE,
    hora: SALE,
    id: NS_ID,
    menu_dia_id: NS_FUERA,
    momento: SALE,
    observaciones: SALE,
    tipo_plato: SALE,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.biberones': seccion('biberones', {
    agenda_id: NS_ANIDADA,
    cantidad_ml: SALE,
    created_at: SALE,
    hora: SALE,
    id: NS_ID,
    observaciones: SALE,
    tipo: SALE,
    tomado_completo: SALE,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.suenos': seccion('suenos', {
    agenda_id: NS_ANIDADA,
    calidad: SALE,
    created_at: SALE,
    hora_fin: SALE,
    hora_inicio: SALE,
    id: NS_ID,
    observaciones: SALE,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.deposiciones': seccion('deposiciones', {
    agenda_id: NS_ANIDADA,
    cantidad: SALE,
    consistencia: SALE,
    created_at: SALE,
    hora: SALE,
    id: NS_ID,
    observaciones: SALE,
    tipo: SALE,
    updated_at: SALE,
  }),
  'nino.asistencias': seccion('asistencias', {
    created_at: SALE,
    estado: SALE,
    fecha: SALE,
    hora_llegada: SALE,
    id: NS_ID,
    nino_id: NS_SUJETO,
    observaciones: SALE,
    registrada_por: NS_PERSONA,
    updated_at: SALE,
  }),
  'nino.ausencias': seccion('ausencias', {
    created_at: SALE,
    descripcion: SALE,
    fecha_fin: SALE,
    fecha_inicio: SALE,
    id: NS_ID,
    motivo: SALE,
    nino_id: NS_SUJETO,
    reportada_por: { rol: 'reportada_por_rol', fecha: 'created_at' },
    updated_at: SALE,
  }),
  'nino.informes_evolucion': seccion('informes_evolucion', {
    centro_id: NS_CENTRO,
    creado_por: { rol: 'creado_por_rol', fecha: 'created_at' },
    created_at: SALE,
    curso_academico_id: NS_FUERA,
    estado: SALE,
    estructura_snapshot: SALE,
    id: NS_ID,
    nino_id: NS_SUJETO,
    notificado_at: SALE,
    observaciones_generales: SALE,
    periodo: SALE,
    plantilla_id: NS_FUERA,
    publicado_at: SALE,
    respuestas: SALE,
    updated_at: SALE,
  }),
  'nino.autorizaciones': seccion('autorizaciones', {
    ambito: SALE,
    archivada_at: SALE,
    archivada_por: NS_PERSONA,
    aula_id: NS_FUERA,
    centro_id: NS_CENTRO,
    creado_por: NS_PERSONA,
    created_at: SALE,
    datos: SALE,
    es_plantilla: SALE,
    estado: SALE,
    evento_id: SALE,
    firmantes_requeridos: SALE,
    id: SALE,
    nino_id: NS_SUJETO,
    plantilla_id: NS_FUERA,
    texto: SALE,
    texto_definitivo: SALE,
    texto_version: SALE,
    tipo: SALE,
    titulo: SALE,
    updated_at: SALE,
    vigencia_desde: SALE,
    vigencia_hasta: SALE,
  }),
  'nino.firmas': seccion('firmas_autorizacion', {
    autorizacion_id: SALE,
    comentario: NS_COMENTARIO_FIRMA_OTROS,
    created_at: SALE,
    datos: NS_DATOS_FIRMA_OTROS,
    decision: SALE,
    firma_imagen: NS_IMAGEN_FIRMA_OTROS,
    firmado_at: SALE,
    firmante_id: NS_PERSONA,
    id: NS_ID,
    ip_address: NS_IP_OTROS,
    metodo_firma: SALE,
    nino_id: NS_SUJETO,
    nombre_tecleado: SALE,
    rol_firmante: SALE,
    texto_hash: SALE,
    texto_version: SALE,
    user_agent: NS_IP_OTROS,
  }),
  'nino.firmas_documentos': seccion('firmas_documentos_centro', {
    centro_id: NS_CENTRO,
    curso_academico_id: NS_DOCUMENTO_COPIADO,
    curso_nombre: SALE,
    documento_id: NS_DOCUMENTO_COPIADO,
    firma_imagen: NS_IMAGEN_DOC_OTROS,
    firmado_at: SALE,
    firmante_id: NS_PERSONA,
    id: NS_ID,
    ip_address: NS_IP_DOC_OTROS,
    metodo_firma: SALE,
    nino_id: NS_SUJETO,
    nombre_tecleado: SALE,
    numero: SALE,
    rol_firmante: SALE,
    sha256: SALE,
    titulo: SALE,
    user_agent: NS_IP_DOC_OTROS,
    version_id: NS_DOCUMENTO_COPIADO,
  }),
  'nino.administraciones_medicacion': seccion('administraciones_medicacion', {
    administrado_en: SALE,
    administrado_por: { rol: 'administrado_por_rol', fecha: 'administrado_en' },
    autorizacion_id: SALE,
    centro_id: NS_CENTRO,
    confirmado_at: SALE,
    confirmado_por: { rol: 'confirmado_por_rol', fecha: 'confirmado_at' },
    created_at: SALE,
    dosis: SALE,
    id: NS_ID,
    medicamento: SALE,
    nino_id: NS_SUJETO,
    notas: SALE,
  }),
}

type Secciones = typeof SECCIONES_RECOLECTAR
export type RutaRecolectar = keyof Secciones

/** Las columnas que se piden: lo que sale, más lo que el código usa (`seLee`) y los uuid del rol. */
type QueSePiden<R extends RutaRecolectar> = {
  [K in keyof Secciones[R]['columnas']]: Secciones[R]['columnas'][K] extends {
    noSale: string
    seLee: string
  }
    ? K
    : Secciones[R]['columnas'][K] extends { noSale: string }
      ? never
      : K
}[keyof Secciones[R]['columnas']]

/** Una fila de la sección tal como se lee: las columnas que se piden. */
export type FilaDe<R extends RutaRecolectar> = Pick<
  Tablas[Secciones[R]['tabla']]['Row'],
  QueSePiden<R> & keyof Tablas[Secciones[R]['tabla']]['Row']
>

function decisiones(ruta: RutaRecolectar): Array<[string, DecisionColumnaApp]> {
  return Object.entries(SECCIONES_RECOLECTAR[ruta].columnas as Record<string, DecisionColumnaApp>)
}

/** Las columnas que se piden de la sección, para el `select`. */
export function columnasDe(ruta: RutaRecolectar): string {
  return decisiones(ruta)
    .filter(([, d]) => !('noSale' in d) || d.seLee !== undefined)
    .map(([c]) => c)
    .join(', ')
}

/** Las claves que van en lugar de un id en la sección (`enSuLugar`), como tipo. */
export type ClavesEnSuLugar<R extends RutaRecolectar> = {
  [K in keyof Secciones[R]['columnas']]: Secciones[R]['columnas'][K] extends {
    enSuLugar: infer C extends string
  }
    ? C
    : never
}[keyof Secciones[R]['columnas']]

/** Los id de la sección que se cambian por algo legible: columna y clave que va en su lugar. */
export function enSuLugarDe(ruta: RutaRecolectar): Array<{ columna: string; clave: string }> {
  return decisiones(ruta).flatMap(([c, d]) =>
    'enSuLugar' in d ? [{ columna: c, clave: d.enSuLugar }] : []
  )
}

/** Los uuid de la sección que se cambian por su rol: columna, clave del rol y columna de la fecha. */
export function rolesDe(
  ruta: RutaRecolectar
): Array<{ columna: string; clave: string; fecha: string }> {
  return decisiones(ruta).flatMap(([c, d]) =>
    'rol' in d ? [{ columna: c, clave: d.rol, fecha: d.fecha }] : []
  )
}

/**
 * La fila tal como se entrega: sin lo que no sale (también lo que se leyó para el código), ni los
 * uuid del rol, ni los id que se cambian por algo legible. Las columnas que no son de la tabla (las
 * embebidas, el rol y lo legible ya puestos) se quedan.
 */
export function entregar(
  ruta: RutaRecolectar,
  fila: Record<string, unknown>
): Record<string, unknown> {
  const quitar = new Set(
    decisiones(ruta)
      .filter(([, d]) => 'noSale' in d || 'rol' in d || 'enSuLugar' in d)
      .map(([c]) => c)
  )
  return Object.fromEntries(Object.entries(fila).filter(([k]) => !quitar.has(k)))
}
