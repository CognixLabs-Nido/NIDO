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

export type DecisionColumnaApp = { sale: true } | { noSale: string } | { saleSinRepasar: true }

type Columnas<T extends keyof Tablas> = keyof Tablas[T]['Row'] & string

function seccion<T extends keyof Tablas, const C extends Record<Columnas<T>, DecisionColumnaApp>>(
  tabla: T,
  columnas: C & Record<Exclude<keyof C, Columnas<T>>, never>
) {
  return { tabla, columnas: columnas as C }
}

const SSR = { saleSinRepasar: true } as const

/** Por ruta: `usuario.` o `nino.` y la clave del export (y la de dentro, si la hay). */
export const SECCIONES_RECOLECTAR = {
  'usuario.ficha': seccion('usuarios', {
    consentimiento_privacidad_version: SSR,
    consentimiento_terminos_version: SSR,
    created_at: SSR,
    deleted_at: SSR,
    foto_url: SSR,
    id: SSR,
    idioma_preferido: SSR,
    nombre_completo: SSR,
    updated_at: SSR,
  }),
  'usuario.roles': seccion('roles_usuario', {
    centro_id: SSR,
    created_at: SSR,
    deleted_at: SSR,
    deleted_reason: SSR,
    id: SSR,
    rol: SSR,
    usuario_id: SSR,
  }),
  'usuario.consentimientos': seccion('consentimientos', {
    aceptado_en: SSR,
    created_at: SSR,
    id: SSR,
    ip_address: SSR,
    metodo_firma: SSR,
    nino_id: SSR,
    revocado_en: SSR,
    tipo: SSR,
    user_agent: SSR,
    usuario_id: SSR,
    version: SSR,
  }),
  'usuario.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SSR,
    deleted_at: SSR,
    deleted_reason: SSR,
    descripcion_parentesco: SSR,
    id: SSR,
    nino_id: SSR,
    parentesco: SSR,
    permisos: SSR,
    tipo_vinculo: SSR,
    updated_at: SSR,
    usuario_id: SSR,
  }),
  'usuario.mensajes': seccion('mensajes', {
    autor_id: SSR,
    contenido: SSR,
    conversacion_id: SSR,
    created_at: SSR,
    erroneo: SSR,
    id: SSR,
    updated_at: SSR,
  }),
  'usuario.ausencias_reportadas': seccion('ausencias', {
    created_at: SSR,
    descripcion: SSR,
    fecha_fin: SSR,
    fecha_inicio: SSR,
    id: SSR,
    motivo: SSR,
    nino_id: SSR,
    reportada_por: SSR,
    updated_at: SSR,
  }),
  'usuario.invitaciones_a_citas': seccion('cita_invitados', {
    centro_id: SSR,
    cita_id: SSR,
    comentario: SSR,
    created_at: SSR,
    estado: SSR,
    id: SSR,
    nombre_externo: SSR,
    respondido_at: SSR,
    respondido_por: SSR,
    updated_at: SSR,
    usuario_id: SSR,
  }),
  'usuario.recordatorios_recibidos': seccion('recordatorios', {
    aula_id: SSR,
    centro_id: SSR,
    completado_en: SSR,
    completado_por: SSR,
    creado_por: SSR,
    created_at: SSR,
    descripcion: SSR,
    destinatario: SSR,
    erroneo: SSR,
    id: SSR,
    nino_id: SSR,
    titulo: SSR,
    updated_at: SSR,
    usuario_destinatario_id: SSR,
    vencimiento: SSR,
  }),
  'usuario.firmas_realizadas': seccion('firmas_autorizacion', {
    autorizacion_id: SSR,
    comentario: SSR,
    created_at: SSR,
    datos: SSR,
    decision: SSR,
    firma_imagen: SSR,
    firmado_at: SSR,
    firmante_id: SSR,
    id: SSR,
    ip_address: SSR,
    metodo_firma: SSR,
    nino_id: SSR,
    nombre_tecleado: SSR,
    rol_firmante: SSR,
    texto_hash: SSR,
    texto_version: SSR,
    user_agent: SSR,
  }),
  'nino.ficha': seccion('ninos', {
    apellidos: SSR,
    centro_id: SSR,
    created_at: SSR,
    deleted_at: SSR,
    deleted_reason: SSR,
    direccion_calle: SSR,
    direccion_ciudad: SSR,
    direccion_cp: SSR,
    direccion_numero: SSR,
    estado_civil_familia: SSR,
    familia_id: SSR,
    fecha_nacimiento: SSR,
    foto_url: SSR,
    id: SSR,
    idioma_principal: SSR,
    libro_familia_path: SSR,
    nacionalidad: SSR,
    nombre: SSR,
    notas_admin: SSR,
    puede_aparecer_en_fotos: SSR,
    purgado_en: SSR,
    requiere_ambos_firmantes: SSR,
    sexo: SSR,
    updated_at: SSR,
  }),
  'nino.datos_pedagogicos': seccion('datos_pedagogicos_nino', {
    alimentacion_observaciones: SSR,
    control_esfinteres: SSR,
    control_esfinteres_observaciones: SSR,
    created_at: SSR,
    deleted_at: SSR,
    id: SSR,
    idiomas_casa: SSR,
    lactancia_estado: SSR,
    lactancia_observaciones: SSR,
    nino_id: SSR,
    siesta_horario_habitual: SSR,
    siesta_numero_diario: SSR,
    siesta_observaciones: SSR,
    tiene_hermanos_en_centro: SSR,
    tipo_alimentacion: SSR,
    updated_at: SSR,
  }),
  'nino.vinculos_familiares': seccion('vinculos_familiares', {
    created_at: SSR,
    deleted_at: SSR,
    deleted_reason: SSR,
    descripcion_parentesco: SSR,
    id: SSR,
    nino_id: SSR,
    parentesco: SSR,
    permisos: SSR,
    tipo_vinculo: SSR,
    updated_at: SSR,
    usuario_id: SSR,
  }),
  'nino.agendas_diarias': seccion('agendas_diarias', {
    created_at: SSR,
    estado_general: SSR,
    fecha: SSR,
    humor: SSR,
    id: SSR,
    nino_id: SSR,
    observaciones_generales: SSR,
    updated_at: SSR,
  }),
  'nino.agendas_diarias.comidas': seccion('comidas', {
    agenda_id: SSR,
    cantidad: SSR,
    created_at: SSR,
    descripcion: SSR,
    hora: SSR,
    id: SSR,
    menu_dia_id: SSR,
    momento: SSR,
    observaciones: SSR,
    tipo_plato: SSR,
    updated_at: SSR,
  }),
  'nino.agendas_diarias.biberones': seccion('biberones', {
    agenda_id: SSR,
    cantidad_ml: SSR,
    created_at: SSR,
    hora: SSR,
    id: SSR,
    observaciones: SSR,
    tipo: SSR,
    tomado_completo: SSR,
    updated_at: SSR,
  }),
  'nino.agendas_diarias.suenos': seccion('suenos', {
    agenda_id: SSR,
    calidad: SSR,
    created_at: SSR,
    hora_fin: SSR,
    hora_inicio: SSR,
    id: SSR,
    observaciones: SSR,
    updated_at: SSR,
  }),
  'nino.agendas_diarias.deposiciones': seccion('deposiciones', {
    agenda_id: SSR,
    cantidad: SSR,
    consistencia: SSR,
    created_at: SSR,
    hora: SSR,
    id: SSR,
    observaciones: SSR,
    tipo: SSR,
    updated_at: SSR,
  }),
  'nino.asistencias': seccion('asistencias', {
    created_at: SSR,
    estado: SSR,
    fecha: SSR,
    hora_llegada: SSR,
    hora_salida: SSR,
    id: SSR,
    nino_id: SSR,
    observaciones: SSR,
    registrada_por: SSR,
    updated_at: SSR,
  }),
  'nino.ausencias': seccion('ausencias', {
    created_at: SSR,
    descripcion: SSR,
    fecha_fin: SSR,
    fecha_inicio: SSR,
    id: SSR,
    motivo: SSR,
    nino_id: SSR,
    reportada_por: SSR,
    updated_at: SSR,
  }),
  'nino.informes_evolucion': seccion('informes_evolucion', {
    centro_id: SSR,
    creado_por: SSR,
    created_at: SSR,
    curso_academico_id: SSR,
    estado: SSR,
    estructura_snapshot: SSR,
    id: SSR,
    nino_id: SSR,
    notificado_at: SSR,
    observaciones_generales: SSR,
    periodo: SSR,
    plantilla_id: SSR,
    publicado_at: SSR,
    respuestas: SSR,
    updated_at: SSR,
  }),
  'nino.autorizaciones': seccion('autorizaciones', {
    ambito: SSR,
    archivada_at: SSR,
    archivada_por: SSR,
    aula_id: SSR,
    centro_id: SSR,
    creado_por: SSR,
    created_at: SSR,
    datos: SSR,
    es_plantilla: SSR,
    estado: SSR,
    evento_id: SSR,
    firmantes_requeridos: SSR,
    id: SSR,
    nino_id: SSR,
    plantilla_id: SSR,
    texto: SSR,
    texto_definitivo: SSR,
    texto_version: SSR,
    tipo: SSR,
    titulo: SSR,
    updated_at: SSR,
    vigencia_desde: SSR,
    vigencia_hasta: SSR,
  }),
  'nino.firmas': seccion('firmas_autorizacion', {
    autorizacion_id: SSR,
    comentario: SSR,
    created_at: SSR,
    datos: SSR,
    decision: SSR,
    firma_imagen: SSR,
    firmado_at: SSR,
    firmante_id: SSR,
    id: SSR,
    ip_address: SSR,
    metodo_firma: SSR,
    nino_id: SSR,
    nombre_tecleado: SSR,
    rol_firmante: SSR,
    texto_hash: SSR,
    texto_version: SSR,
    user_agent: SSR,
  }),
  'nino.administraciones_medicacion': seccion('administraciones_medicacion', {
    administrado_en: SSR,
    administrado_por: SSR,
    autorizacion_id: SSR,
    centro_id: SSR,
    confirmado_at: SSR,
    confirmado_por: SSR,
    created_at: SSR,
    dosis: SSR,
    id: SSR,
    medicamento: SSR,
    nino_id: SSR,
    notas: SSR,
  }),
}

type Secciones = typeof SECCIONES_RECOLECTAR
export type RutaRecolectar = keyof Secciones

type QueSalen<R extends RutaRecolectar> = {
  [K in keyof Secciones[R]['columnas']]: Secciones[R]['columnas'][K] extends { noSale: string }
    ? never
    : K
}[keyof Secciones[R]['columnas']]

/** Una fila de la sección: solo las columnas que salen, que son las que se piden. */
export type FilaDe<R extends RutaRecolectar> = Pick<
  Tablas[Secciones[R]['tabla']]['Row'],
  QueSalen<R> & keyof Tablas[Secciones[R]['tabla']]['Row']
>

/** Las columnas que salen de la sección, para el `select`. */
export function columnasDe(ruta: RutaRecolectar): string {
  const columnas = SECCIONES_RECOLECTAR[ruta].columnas as Record<string, DecisionColumnaApp>
  return Object.entries(columnas)
    .filter(([, d]) => !('noSale' in d))
    .map(([c]) => c)
    .join(', ')
}
