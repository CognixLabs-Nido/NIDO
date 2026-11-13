/**
 * Los tipos de la base que usa la app: `database.ts` (generado, no se toca a mano) más lo que el
 * generador no sabe. Se importa SIEMPRE de aquí (`@/types/db`); importar `@/types/database` fuera de
 * este fichero lo para el lint (`no-restricted-imports`).
 *
 * Lo que el generador no sabe, y esta capa recupera:
 *
 * 1. **La nulabilidad de las columnas de una función `RETURNS TABLE`.** Postgres no guarda si una
 *    columna de salida puede ser NULL, y el generador las da todas por no nulas. Medido el
 *    2026-11-12: `ficha_gestion_ninos` devuelve `dni` NULL en los 4 niños de producción, y el tipo
 *    generado decía `string`. Aquí todas son `| null` salvo las de `NO_NULAS`, cada una con el
 *    motivo que da su cuerpo. La lista de funciones la comprueba contra el catálogo
 *    `tipos-overlay.rls.test.ts`: una función `RETURNS TABLE` nueva sin entrada pone la CI en rojo.
 *
 * 2. **Los argumentos que aceptan NULL a propósito.** El generador tipa los argumentos de una
 *    función como no nulos. Los de `ARGS_ANULABLES` los trata el cuerpo (leído en producción el
 *    2026-11-12), y la app los manda NULL.
 *
 * 3. **Las columnas generadas** (`GENERATED ALWAYS AS`): nadie las escribe, tampoco la Dirección ni
 *    `service_role` (428C9). El generador las deja en `Insert` y `Update` como opcionales; aquí son
 *    `?: never`, para que escribirlas no compile.
 */
import type { Database as Generada } from './database'

export type { Json } from './database'
export { Constants } from './database'

type PG = Generada['public']
type FG = PG['Functions']

// ─── 1. Las funciones RETURNS TABLE ────────────────────────────────────────────────────────────

/** Las funciones de `public` que devuelven `RETURNS TABLE`, leídas del catálogo de producción. */
export const FUNCIONES_RETURNS_TABLE = [
  'accesos_datos_bloqueados_centro',
  'alertas_medicas',
  'altas_sin_terminar',
  'anadir_cargo_puntual',
  'buscar_auth_user_por_email',
  'contenido_firmas',
  'cuentas_vencidas',
  'documentos_firma_centro',
  'documentos_firma_nino',
  'expedientes_vencidos',
  'familias_fiscal_vencidas',
  'ficha_gestion_ninos',
  'fichero_remesa_vigente',
  'ficheros_remesa_huerfanos',
  'ficheros_remesa_vencidos',
  'fijar_asignaciones_concepto',
  'fijar_fecha_cobro_recibos',
  'firmas_vencidas',
  'get_datos_acreedor',
  'get_info_medica_emergencia',
  'get_mandatos_remesa',
  'get_motivos_baja_matriculas',
  'get_recorrido_nino_familia',
  'lecturas_ficha_medica',
  'listado_pase_servicios',
  'listar_esqueletos_huerfanos_stub',
  'mis_peticiones_olvido',
  'olvido_destinatarios',
  'olvido_pendientes',
  'opciones_olvido',
  'peticiones_olvido_centro',
  'platform_crear_centro',
  'platform_metricas',
  'retenciones_centro',
  'sujetos_bloqueados',
  'sujetos_retencion',
  'telefonos_familia_de_nino',
  'tutores_de_familia',
] as const satisfies readonly (keyof FG)[]

type FuncionTabla = (typeof FUNCIONES_RETURNS_TABLE)[number]

/**
 * Columnas no nulas: solo las que la app necesita, y cada una DEMOSTRADA contra la base. Lo que no está
 * aquí es `| null`.
 *
 * `tipos-overlay.rls.test.ts` pasa cada una por `src/test/tipos/nulabilidad.ts` con el cuerpo de la
 * función y `pg_attribute.attnotnull` de la base efímera, y se pone rojo si alguna no se sostiene. Las
 * reglas que acepta son pocas y cerradas: columna NOT NULL atada por FROM o JOIN interior (nunca LEFT),
 * literal, `IS [NOT] NULL`, `[NOT] EXISTS`, `count`, `coalesce(…, no nula)`, CASE con ELSE y todas sus
 * ramas no nulas, o un filtro `IS NOT NULL` sobre la misma expresión. Lo que parezca imposible que dé
 * NULL por otra razón (una variable, `concat_ws`, una comparación) NO entra: va a `NO_DEMOSTRABLES`.
 * Los comentarios dicen por qué regla entra cada una; lo que manda es el test.
 */
export const NO_NULAS = {
  /** NOT NULL de `accesos_datos_bloqueados`; `lector_nombre` viene de un LEFT JOIN. */
  accesos_datos_bloqueados_centro: [
    'leido_en',
    'sujeto_tipo',
    'sujeto_id',
    'motivo_tipo',
    'motivo',
    'accion',
    'apartados',
  ],
  /** `nino_id` NOT NULL; las otras dos son `IS NOT NULL`. */
  alertas_medicas: ['nino_id', 'alergia_grave', 'medicacion'],
  /** `ninos.id`; `estado`, CASE con ELSE (en `privado.alta_sin_terminar`); `familia_nueva`, NOT EXISTS. */
  altas_sin_terminar: ['nino_id', 'estado', 'familia_nueva'],
  /** `auth.users.id`, la clave. El email no: `auth.users.email` admite NULL. */
  buscar_auth_user_por_email: ['id'],
  /** `firmas_autorizacion.id`, la clave. */
  contenido_firmas: ['firma_id'],
  /** `roles_usuario`, `vinculos_familiares` (NOT NULL) y `familia_tutores` con `usuario_id IS NOT NULL`. */
  cuentas_vencidas: ['usuario_id', 'centro_id'],
  /** `ninos.id` y, de `documentos_centro` (NOT NULL, por JOIN en las dos ramas), el documento; `estado`, CASE con ELSE. */
  documentos_firma_centro: ['nino_id', 'documento_id', 'titulo', 'obligatorio', 'estado'],
  /** De `documentos_centro` (NOT NULL, por JOIN en las dos ramas de `pedidos`); `estado`, CASE con ELSE. */
  documentos_firma_nino: ['documento_id', 'titulo', 'de_curso', 'obligatorio', 'orden', 'estado'],
  /** NOT NULL de `ninos`. */
  expedientes_vencidos: ['nino_id', 'centro_id'],
  /** NOT NULL de `familias`; las rutas, `coalesce(array_agg(…), '{}')` sin elementos NULL. */
  familias_fiscal_vencidas: ['familia_id', 'centro_id', 'mandatos', 'dnis'],
  /** `ninos.id`. Las demás, no: `dni` NULL en los 4 niños de producción (2026-11-12). */
  ficha_gestion_ninos: ['nino_id'],
  /** NOT NULL de `remesa_ficheros`. */
  fichero_remesa_vigente: ['fichero_id', 'msg_id', 'generado_at', 'sha256', 'ruta'],
  /** NOT NULL de `remesa_ficheros`. */
  ficheros_remesa_vencidos: ['fichero_id', 'ruta'],
  /** NOT NULL de `ninos`. */
  firmas_vencidas: ['nino_id', 'centro_id'],
  /** De `recibos` y `familias`, por JOIN; lo del mandato no (LEFT JOIN LATERAL: sin mandato, NULL). */
  get_mandatos_remesa: ['recibo_id', 'familia_id', 'familia_etiqueta', 'total_centimos'],
  /** `matriculas.id`; `motivo_baja`, filtrado con `IS NOT NULL`. */
  get_motivos_baja_matriculas: ['matricula_id', 'motivo_baja'],
  /** NOT NULL de `matriculas`, `aulas` y `cursos_academicos`, por JOIN; `fecha_baja` no. */
  get_recorrido_nino_familia: [
    'matricula_id',
    'aula_nombre',
    'curso_id',
    'curso_nombre',
    'curso_fecha_inicio',
    'fecha_alta',
    'estado',
  ],
  /** NOT NULL de `lecturas_ficha_medica`; el nombre viene de un LEFT JOIN y de un CASE sin ELSE. */
  lecturas_ficha_medica: ['leida_en', 'rol_lector', 'origen', 'campos'],
  /** NOT NULL de `ninos` y `aulas`, por JOIN; `apellidos` no. */
  listado_pase_servicios: ['nino_id', 'nombre', 'aula_id', 'aula_nombre'],
  /** `auth.users.id`; el centro, una subconsulta que puede no dar fila. */
  listar_esqueletos_huerfanos_stub: ['usuario_id'],
  /** NOT NULL de `olvido_solicitudes`. */
  mis_peticiones_olvido: [
    'id',
    'sujeto_tipo',
    'sujeto_id',
    'centro_id',
    'pedida_por_centro',
    'solicitado_en',
    'estado',
    'inmediato',
    'por_plazo',
  ],
  /** Filtrado con `x.u IS NOT NULL`. */
  olvido_destinatarios: ['usuario_id'],
  /** NOT NULL de `olvido_solicitudes`. */
  olvido_pendientes: ['solicitud_id', 'sujeto_tipo', 'sujeto_id', 'centro_id'],
  /** Las dos ramas: literal y NOT NULL de `ninos` / `centros`. */
  opciones_olvido: ['sujeto_tipo', 'centro_id', 'centro_nombre'],
  /** NOT NULL de `olvido_solicitudes`. */
  peticiones_olvido_centro: [
    'id',
    'sujeto_tipo',
    'sujeto_id',
    'pedida_por_centro',
    'solicitado_en',
    'estado',
    'inmediato',
    'por_plazo',
  ],
  /** NOT NULL de `centros`; los recuentos, `count`; las alertas, NOT EXISTS e `IS NULL`. El curso no: LEFT JOIN. */
  platform_metricas: [
    'centro_id',
    'nombre',
    'ninos_matriculados',
    'ninos_en_alta',
    'familias',
    'personal',
    'personal_baja_temporal',
    'direccion',
    'aulas',
    'invitaciones_pendientes',
    'sin_admin',
    'sin_curso_activo',
  ],
  /** NOT NULL de `retenciones`; los nombres, subconsulta o LEFT JOIN. */
  retenciones_centro: ['sujeto_tipo', 'sujeto_id', 'motivo_tipo', 'motivo', 'puesta_en'],
  /** Las dos ramas: literal, `ninos.id` (por el CTE) / `usuarios.id` por JOIN; `estado`, CASE con ELSE. */
  sujetos_retencion: ['sujeto_tipo', 'sujeto_id', 'estado'],
  /** `familia_tutores.rol_familia` NOT NULL, por JOIN interior. El nombre y el teléfono pueden faltar. */
  telefonos_familia_de_nino: ['rol_familia'],
  /** `id` y `rol_familia` NOT NULL por FROM; `tiene_cuenta`, `IS NOT NULL`. */
  tutores_de_familia: ['id', 'rol_familia', 'tiene_cuenta'],
} as const satisfies { readonly [F in FuncionTabla]?: readonly (keyof Fila<F>)[] }

/**
 * Lo que la app trataba como no nulo y la base NO puede demostrar con esas reglas, con el motivo. Se
 * quedan `| null` y la app lo maneja. El test exige que sigan sin demostrarse: si un día se pueden,
 * pasan a `NO_NULAS` (y si la regla las aceptara por error, el test lo dice aquí).
 */
export const NO_DEMOSTRABLES = {
  altas_sin_terminar: {
    propuesta: '`desde IS NOT NULL AND desde <= …`: un AND, fuera de las reglas',
  },
  mis_peticiones_olvido: {
    puede_retirar: "`estado = 'pendiente'`: una comparación, fuera de las reglas",
  },
  olvido_pendientes: {
    gracia_hasta: '`gracia_hasta` admite NULL; el filtro es `<= now()`, no `IS NOT NULL`',
  },
  opciones_olvido: {
    sujeto_id:
      'en la rama de la cuenta es la variable `v_uid` (comprobada antes en plpgsql, no en la consulta)',
  },
  platform_crear_centro: {
    centro_id: 'la variable `v_centro` (`INSERT … RETURNING id INTO`)',
    invitacion_id: 'la variable `v_invitacion`, lo que devuelve `platform_invitar_admin`',
  },
  sujetos_retencion: {
    nombre: '`btrim(concat_ws(…))` en la rama del niño: una función, fuera de las reglas',
  },
} as const satisfies { readonly [F in FuncionTabla]?: { readonly [C in keyof Fila<F>]?: string } }

type Fila<F extends FuncionTabla> = FG[F]['Returns'] extends (infer R)[] ? R : never
type NoNula<F extends FuncionTabla> = F extends keyof typeof NO_NULAS
  ? (typeof NO_NULAS)[F][number]
  : never
type FilaReal<F extends FuncionTabla> = {
  [K in keyof Fila<F>]: K extends NoNula<F> ? Fila<F>[K] : Fila<F>[K] | null
}

// ─── 2. Argumentos que aceptan NULL ────────────────────────────────────────────────────────────

type ARGS_ANULABLES = {
  /** NULL = no se toca (`coalesce(p_x, x)`; `p_retirado` con `CASE WHEN … IS NULL`). */
  editar_documento_centro: 'p_titulo' | 'p_de_curso' | 'p_obligatorio' | 'p_orden' | 'p_retirado'
  /** NULL en un documento que no es de curso (`IS NOT DISTINCT FROM`; el CHECK lo exige así). */
  registrar_version_documento: 'p_curso_academico_id'
  /** NULL = modo invitar: sin rol ni vínculo, que crea la aceptación (`IF p_usuario_id IS NOT NULL`). */
  crear_o_anadir_a_familia: 'p_usuario_id'
}

type ConAnulables<A, N> = A extends unknown
  ? { [K in keyof A]: K extends N ? A[K] | null : A[K] }
  : never

type Funciones = {
  [F in keyof FG]: Omit<FG[F], 'Args' | 'Returns'> & {
    Args: F extends keyof ARGS_ANULABLES
      ? ConAnulables<FG[F]['Args'], ARGS_ANULABLES[F]>
      : FG[F]['Args']
    Returns: F extends FuncionTabla ? FilaReal<F>[] : FG[F]['Returns']
  }
}

// ─── 3. Columnas generadas ─────────────────────────────────────────────────────────────────────

/** Las columnas generadas de `public` (`tabla.columna`), las mismas que `Tablas` cierra abajo. */
export const COLUMNAS_GENERADAS = ['lista_espera.apellidos_nino', 'ninos.apellidos'] as const

type SinEscribir<T, C extends PropertyKey> = Omit<T, C & keyof T> & { [K in C & keyof T]?: never }
type ConGeneradas<T extends { Insert: object; Update: object }, C extends PropertyKey> = Omit<
  T,
  'Insert' | 'Update'
> & {
  Insert: SinEscribir<T['Insert'], C>
  Update: SinEscribir<T['Update'], C>
}

type Tablas = Omit<PG['Tables'], 'ninos' | 'lista_espera'> & {
  /** `apellidos`: generada de `primer_apellido` y `segundo_apellido` (`20270112120000`). */
  ninos: ConGeneradas<PG['Tables']['ninos'], 'apellidos'>
  /** `apellidos_nino`: generada de los dos apellidos del prospecto (`20270112120000`). */
  lista_espera: ConGeneradas<PG['Tables']['lista_espera'], 'apellidos_nino'>
}

// ─── El tipo de la base ────────────────────────────────────────────────────────────────────────

export type Database = Omit<Generada, 'public'> & {
  public: Omit<PG, 'Tables' | 'Functions'> & {
    Tables: Tablas
    Functions: Funciones
  }
}

type Esquema = Database['public']

export type Tables<T extends keyof Esquema['Tables']> = Esquema['Tables'][T]['Row']
export type TablesInsert<T extends keyof Esquema['Tables']> = Esquema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Esquema['Tables']> = Esquema['Tables'][T]['Update']
export type Enums<T extends keyof Esquema['Enums']> = Esquema['Enums'][T]
