import type { Database } from '@/types/database'

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
 * - `saleSinRepasar`: lo que el `select('*')` sacaba el 2026-11-01 sin repasar (la lista fechada).
 */
export type DecisionColumnaApp =
  | { sale: true }
  | { noSale: string; seLee?: string }
  | { rol: string; fecha: string }
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
    consentimiento_privacidad_version: SSR,
    consentimiento_terminos_version: SSR,
    created_at: SALE,
    deleted_at: SALE,
    foto_url: SSR,
    id: NS_ID,
    idioma_preferido: SSR,
    nombre_completo: SSR,
    updated_at: SALE,
  }),
  'usuario.roles': seccion('roles_usuario', {
    centro_id: { ...NS_CENTRO, seLee: 'para el registro del export (`export_log.centro_id`)' },
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    id: NS_ID,
    rol: SSR,
    usuario_id: NS_SUJETO,
  }),
  'usuario.consentimientos': seccion('consentimientos', {
    aceptado_en: SSR,
    created_at: SALE,
    id: NS_ID,
    ip_address: SALE,
    metodo_firma: SALE,
    nino_id: NS_FUERA,
    revocado_en: SSR,
    tipo: SSR,
    user_agent: SALE,
    usuario_id: NS_SUJETO,
    version: SSR,
  }),
  'usuario.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    descripcion_parentesco: SSR,
    id: NS_ID,
    nino_id: { ...NS_FUERA, seLee: 'para encontrar los hilos de mensajes de sus hijos' },
    parentesco: SSR,
    permisos: SSR,
    tipo_vinculo: SSR,
    updated_at: SALE,
    usuario_id: NS_SUJETO,
  }),
  'usuario.mensajes': seccion('mensajes', {
    autor_id: { rol: 'autor_rol', fecha: 'created_at' },
    contenido: SSR,
    conversacion_id: {
      ...NS_FUERA,
      seLee: 'para dar el rol a la fecha del autor, en el centro y el aula del hilo',
    },
    created_at: SALE,
    erroneo: SSR,
    id: NS_ID,
    updated_at: SALE,
  }),
  'usuario.ausencias_reportadas': seccion('ausencias', {
    created_at: SALE,
    descripcion: SSR,
    fecha_fin: SSR,
    fecha_inicio: SSR,
    id: NS_ID,
    motivo: SSR,
    nino_id: NS_FUERA,
    reportada_por: NS_SUJETO,
    updated_at: SALE,
  }),
  'usuario.invitaciones_a_citas': seccion('cita_invitados', {
    centro_id: NS_CENTRO,
    cita_id: NS_FUERA,
    comentario: SSR,
    created_at: SALE,
    estado: SSR,
    id: NS_ID,
    nombre_externo: SSR,
    respondido_at: SSR,
    respondido_por: NS_PERSONA,
    updated_at: SALE,
    usuario_id: NS_SUJETO,
  }),
  'usuario.recordatorios_recibidos': seccion('recordatorios', {
    aula_id: NS_FUERA,
    centro_id: { ...NS_CENTRO, seLee: 'para dar el rol a la fecha de quien lo creó, en su centro' },
    completado_en: SSR,
    completado_por: NS_PERSONA,
    creado_por: { rol: 'creado_por_rol', fecha: 'created_at' },
    created_at: SALE,
    descripcion: SSR,
    destinatario: SSR,
    erroneo: SSR,
    id: NS_ID,
    nino_id: {
      ...NS_FUERA,
      seLee: 'para dar el rol a la fecha de quien lo creó, en el aula de ese niño',
    },
    titulo: SSR,
    updated_at: SALE,
    usuario_destinatario_id: NS_SUJETO,
    vencimiento: SSR,
  }),
  'usuario.firmas_realizadas': seccion('firmas_autorizacion', {
    autorizacion_id: NS_FUERA,
    comentario: SSR,
    created_at: SALE,
    datos: SSR,
    decision: SSR,
    firma_imagen: SSR,
    firmado_at: SSR,
    firmante_id: NS_SUJETO,
    id: NS_ID,
    ip_address: SALE,
    metodo_firma: SALE,
    nino_id: NS_FUERA,
    nombre_tecleado: SSR,
    rol_firmante: SSR,
    texto_hash: SALE,
    texto_version: SALE,
    user_agent: SALE,
  }),
  'nino.ficha': seccion('ninos', {
    apellidos: SSR,
    centro_id: { ...NS_CENTRO, seLee: 'para el registro del export (`export_log.centro_id`)' },
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: SALE,
    direccion_calle: SSR,
    direccion_ciudad: SSR,
    direccion_cp: SSR,
    direccion_numero: SSR,
    estado_civil_familia: SSR,
    familia_id: NS_FUERA,
    fecha_nacimiento: SSR,
    foto_url: SSR,
    id: NS_ID,
    idioma_principal: SSR,
    libro_familia_path: SSR,
    nacionalidad: SSR,
    nombre: SSR,
    notas_admin: SSR,
    puede_aparecer_en_fotos: SSR,
    purgado_en: SSR,
    requiere_ambos_firmantes: SSR,
    sexo: SSR,
    updated_at: SALE,
  }),
  'nino.datos_pedagogicos': seccion('datos_pedagogicos_nino', {
    alimentacion_observaciones: SSR,
    control_esfinteres: SSR,
    control_esfinteres_observaciones: SSR,
    created_at: SALE,
    deleted_at: SALE,
    id: NS_ID,
    idiomas_casa: SSR,
    lactancia_estado: SSR,
    lactancia_observaciones: SSR,
    nino_id: NS_SUJETO,
    siesta_horario_habitual: SSR,
    siesta_numero_diario: SSR,
    siesta_observaciones: SSR,
    tiene_hermanos_en_centro: SSR,
    tipo_alimentacion: SSR,
    updated_at: SALE,
  }),
  'nino.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SALE,
    deleted_at: SALE,
    deleted_reason: NS_MOTIVO_OTROS,
    descripcion_parentesco: SSR,
    id: NS_ID,
    nino_id: NS_SUJETO,
    parentesco: SSR,
    permisos: SSR,
    tipo_vinculo: SSR,
    updated_at: SALE,
    usuario_id: NS_PERSONA,
  }),
  'nino.agendas_diarias': seccion('agendas_diarias', {
    created_at: SALE,
    estado_general: SSR,
    fecha: SSR,
    humor: SSR,
    id: NS_ID,
    nino_id: NS_SUJETO,
    observaciones_generales: SSR,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.comidas': seccion('comidas', {
    agenda_id: NS_ANIDADA,
    cantidad: SSR,
    created_at: SALE,
    descripcion: SSR,
    hora: SSR,
    id: NS_ID,
    menu_dia_id: NS_FUERA,
    momento: SSR,
    observaciones: SSR,
    tipo_plato: SSR,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.biberones': seccion('biberones', {
    agenda_id: NS_ANIDADA,
    cantidad_ml: SSR,
    created_at: SALE,
    hora: SSR,
    id: NS_ID,
    observaciones: SSR,
    tipo: SSR,
    tomado_completo: SSR,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.suenos': seccion('suenos', {
    agenda_id: NS_ANIDADA,
    calidad: SSR,
    created_at: SALE,
    hora_fin: SSR,
    hora_inicio: SSR,
    id: NS_ID,
    observaciones: SSR,
    updated_at: SALE,
  }),
  'nino.agendas_diarias.deposiciones': seccion('deposiciones', {
    agenda_id: NS_ANIDADA,
    cantidad: SSR,
    consistencia: SSR,
    created_at: SALE,
    hora: SSR,
    id: NS_ID,
    observaciones: SSR,
    tipo: SSR,
    updated_at: SALE,
  }),
  'nino.asistencias': seccion('asistencias', {
    created_at: SALE,
    estado: SSR,
    fecha: SSR,
    hora_llegada: SSR,
    hora_salida: SSR,
    id: NS_ID,
    nino_id: NS_SUJETO,
    observaciones: SSR,
    registrada_por: NS_PERSONA,
    updated_at: SALE,
  }),
  'nino.ausencias': seccion('ausencias', {
    created_at: SALE,
    descripcion: SSR,
    fecha_fin: SSR,
    fecha_inicio: SSR,
    id: NS_ID,
    motivo: SSR,
    nino_id: NS_SUJETO,
    reportada_por: { rol: 'reportada_por_rol', fecha: 'created_at' },
    updated_at: SALE,
  }),
  'nino.informes_evolucion': seccion('informes_evolucion', {
    centro_id: NS_CENTRO,
    creado_por: { rol: 'creado_por_rol', fecha: 'created_at' },
    created_at: SALE,
    curso_academico_id: NS_FUERA,
    estado: SSR,
    estructura_snapshot: SSR,
    id: NS_ID,
    nino_id: NS_SUJETO,
    notificado_at: SSR,
    observaciones_generales: SSR,
    periodo: SSR,
    plantilla_id: NS_FUERA,
    publicado_at: SSR,
    respuestas: SSR,
    updated_at: SALE,
  }),
  'nino.autorizaciones': seccion('autorizaciones', {
    ambito: SSR,
    archivada_at: SSR,
    archivada_por: NS_PERSONA,
    aula_id: NS_FUERA,
    centro_id: NS_CENTRO,
    creado_por: NS_PERSONA,
    created_at: SALE,
    datos: SSR,
    es_plantilla: SSR,
    estado: SSR,
    evento_id: SALE,
    firmantes_requeridos: SSR,
    id: SALE,
    nino_id: NS_SUJETO,
    plantilla_id: NS_FUERA,
    texto: SSR,
    texto_definitivo: SSR,
    texto_version: SALE,
    tipo: SSR,
    titulo: SSR,
    updated_at: SALE,
    vigencia_desde: SSR,
    vigencia_hasta: SSR,
  }),
  'nino.firmas': seccion('firmas_autorizacion', {
    autorizacion_id: SALE,
    comentario: SSR,
    created_at: SALE,
    datos: SSR,
    decision: SSR,
    firma_imagen: SSR,
    firmado_at: SSR,
    firmante_id: NS_PERSONA,
    id: NS_ID,
    ip_address: NS_IP_OTROS,
    metodo_firma: SALE,
    nino_id: NS_SUJETO,
    nombre_tecleado: SSR,
    rol_firmante: SSR,
    texto_hash: SALE,
    texto_version: SALE,
    user_agent: NS_IP_OTROS,
  }),
  'nino.administraciones_medicacion': seccion('administraciones_medicacion', {
    administrado_en: SSR,
    administrado_por: { rol: 'administrado_por_rol', fecha: 'administrado_en' },
    autorizacion_id: SALE,
    centro_id: NS_CENTRO,
    confirmado_at: SSR,
    confirmado_por: { rol: 'confirmado_por_rol', fecha: 'confirmado_at' },
    created_at: SALE,
    dosis: SSR,
    id: NS_ID,
    medicamento: SSR,
    nino_id: NS_SUJETO,
    notas: SSR,
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

/** Los uuid de la sección que se cambian por su rol: columna, clave del rol y columna de la fecha. */
export function rolesDe(
  ruta: RutaRecolectar
): Array<{ columna: string; clave: string; fecha: string }> {
  return decisiones(ruta).flatMap(([c, d]) =>
    'rol' in d ? [{ columna: c, clave: d.rol, fecha: d.fecha }] : []
  )
}

/**
 * La fila tal como se entrega: sin lo que no sale (también lo que se leyó para el código) ni los
 * uuid del rol. Las columnas que no son de la tabla (las embebidas, el rol ya puesto) se quedan.
 */
export function entregar(
  ruta: RutaRecolectar,
  fila: Record<string, unknown>
): Record<string, unknown> {
  const quitar = new Set(
    decisiones(ruta)
      .filter(([, d]) => 'noSale' in d || 'rol' in d)
      .map(([c]) => c)
  )
  return Object.fromEntries(Object.entries(fila).filter(([k]) => !quitar.has(k)))
}
