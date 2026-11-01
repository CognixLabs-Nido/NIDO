import type { Database } from '@/types/database'

/**
 * La red del export art. 15 (`export_datos_sujeto`): cada columna de cada tabla cuyas filas salen en
 * el export tiene que estar decidida aquí, una por una.
 *
 *  - `sale`: sale, con esa clave.
 *  - `noSale`: no sale A PROPÓSITO, y el texto es el porqué. Lo lee quien revise el export (un
 *    abogado incluido): tiene que ser verdad y entenderse sin abrir el código.
 *  - `porDecidir`: sin repasar todavía. Es lo que había el 2026-11-01 en las tablas que no son
 *    `recibos`, y solo puede menguar: una columna nueva no entra aquí (lo vigila el test con la
 *    lista fechada). El repaso con su porqué es el trozo 2 de la red.
 *
 * El tipo obliga a decidir: cada sección es un `Record` sobre las columnas de su tabla en
 * `Database`, así que una columna nueva en los tipos no compila hasta estar aquí, y una que
 * desaparece tampoco. Los tests comprueban, además, que esto casa con el export de verdad
 * (`columnas-export.test.ts`, contra la última migración que lo define) y con las columnas vivas
 * de la base (`export-columnas.rls.test.ts`, contra la BD del CI): los tipos se escriben a veces a
 * mano y pueden quedarse atrás.
 *
 * Las tablas que el export solo consulta para un nombre (el curso, el aula, el concepto, quién
 * firmó…) no están: sus filas no son datos del sujeto. Lo que lee la app (`recolectar.ts`) tiene su
 * propio catálogo, `columnas-recolectar.ts`.
 */

type Tablas = Database['public']['Tables']

/** `nota`: una decisión que sustituye a otra anterior lo dice aquí, con su fecha. */
export type DecisionColumna =
  | { sale: string; nota?: string }
  | { noSale: string }
  | { porDecidir: true }

export interface SeccionExport<T extends keyof Tablas = keyof Tablas> {
  tabla: T
  columnas: Record<keyof Tablas[T]['Row'] & string, DecisionColumna>
}

function seccion<T extends keyof Tablas>(
  tabla: T,
  columnas: Record<keyof Tablas[T]['Row'] & string, DecisionColumna>
): SeccionExport<T> {
  return { tabla, columnas }
}

const PD = { porDecidir: true } as const

/*
 * Las reglas del trozo 2 de la red (decididas por el responsable el 2026-11-01; son interpretación
 * del art. 15 RGPD, no producto). Cada columna técnica se decide por su clase, con este porqué:
 * R1, las fechas de registro salen siempre (`creado_en`, `actualizado_en`); R2, `deleted_at` sale
 * (`borrado_en`) y `deleted_reason` solo en las filas de la persona; R3, `centro_id` no sale; R4, el
 * uuid de una persona no sale; R5, un id o un enlace sale solo si une dos cosas que el propio
 * export entrega; R6, las claves no salen nunca; R7, la huella de una firma sale, y la IP y el
 * navegador solo en las firmas propias. Las mismas reglas, en `columnas-recolectar.ts`.
 */
const NS_CENTRO = {
  noSale:
    'R3 (2026-11-01): el centro es el responsable del tratamiento, no un dato de la persona; quién es lo dice el aviso de privacidad.',
} as const

const NS_PERSONA = {
  noSale:
    'R4 (2026-11-01): clave interna (uuid) de una persona. A quien recibe el export no le dice nada legible, y es un dato de esa persona.',
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
    'R5 (2026-11-01): la fila ya sale dentro de la fila a la que apunta (su familia o su recibo): la anidación las une, y la clave no añade nada.',
} as const

const NS_SECRETO = {
  noSale:
    'R6 (2026-11-01): es una clave, no información sobre la persona. Un export se descarga y se reenvía: esta clave abriría el canal de notificaciones o la cuenta a quien tuviera el fichero.',
} as const

const NS_IP_OTROS = {
  noSale:
    'R7 (2026-11-01): la IP y el navegador desde los que se dio un consentimiento son datos de quien lo dio, y aquí salen también los que dio el otro tutor del niño. Los de la propia persona salen en `usuario.consentimientos`.',
} as const

const NS_IBAN = {
  noSale:
    'Decisión del responsable del 2026-10-14: del IBAN solo salen los 4 últimos dígitos (`iban_ultimos4`). El cifrado no lo lee nadie sin la clave del centro, y en un fichero que se descarga y se reenvía solo añade riesgo.',
} as const

const SUSTITUYE_467 =
  'R1/R2 (2026-11-01): sustituye a la decisión del #467, que la dejaba fuera como dato del funcionamiento de la base. La misma columna no puede tener dos decisiones según la tabla.'

/** Por ruta: `usuario.` o `nino.` y la clave de la sección (y la de dentro, si la hay). */
export const SECCIONES_EXPORT = {
  'usuario.preferencias': seccion('preferencias_usuario', {
    usuario_id: NS_SUJETO,
    clave: { sale: 'clave' },
    valor: { sale: 'valor' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'usuario.dispositivos': seccion('push_subscriptions', {
    id: NS_ID,
    usuario_id: NS_SUJETO,
    endpoint: NS_SECRETO,
    p256dh: NS_SECRETO,
    auth: NS_SECRETO,
    user_agent: { sale: 'navegador' },
    created_at: { sale: 'registrado_en' },
    updated_at: { sale: 'actualizado_en' },
    last_active_at: { sale: 'ultima_actividad' },
  }),
  'usuario.lecturas_conversaciones': seccion('lectura_conversacion', {
    id: NS_ID,
    usuario_id: NS_SUJETO,
    conversacion_id: { sale: 'conversacion_id' },
    last_read_at: { sale: 'leido_hasta' },
  }),
  'usuario.lecturas_anuncios': seccion('lectura_anuncio', {
    id: NS_ID,
    usuario_id: NS_SUJETO,
    anuncio_id: { sale: 'anuncio_id' },
    leido_at: { sale: 'leido_en' },
  }),
  'usuario.invitaciones': seccion('invitaciones', {
    id: NS_ID,
    token: NS_SECRETO,
    email: { sale: 'email' },
    rol_objetivo: { sale: 'rol_objetivo' },
    centro_id: NS_CENTRO,
    nino_id: NS_FUERA,
    aula_id: NS_FUERA,
    invitado_por: NS_PERSONA,
    expires_at: { sale: 'expira_en' },
    accepted_at: { sale: 'aceptada_en' },
    rejected_at: { sale: 'rechazada_en' },
    created_at: { sale: 'enviada_en' },
    tipo_vinculo: { sale: 'tipo_vinculo' },
    nombre_completo: { sale: 'nombre_completo' },
    tipo_personal_aula: PD,
  }),
  'usuario.lista_espera_contacto': seccion('lista_espera', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    curso_academico_id: NS_FUERA,
    nombre_nino: PD,
    fecha_nacimiento: PD,
    telefono_tutor: { sale: 'telefono_tutor' },
    email_tutor: { sale: 'email_tutor' },
    nota: PD,
    posicion: PD,
    estado: PD,
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    apellidos_nino: PD,
    tutor_usuario_id: NS_SUJETO,
    nino_id: NS_FUERA,
    descartado_at: PD,
  }),
  'usuario.exportaciones': seccion('export_log', {
    id: NS_ID,
    sujeto_tipo: PD,
    sujeto_id: NS_SUJETO,
    solicitado_por: {
      sale: 'solicitado_por_ti',
      nota: 'R4 (2026-11-01): no sale el uuid de quien pidió el export: sale solo si lo pidió la propia persona (sí o no).',
    },
    centro_id: NS_CENTRO,
    created_at: { sale: 'exportado_en' },
  }),
  'usuario.solicitudes_olvido': seccion('olvido_solicitudes', {
    id: NS_ID,
    sujeto_tipo: PD,
    sujeto_id: NS_SUJETO,
    centro_id: NS_CENTRO,
    solicitado_por: NS_PERSONA,
    solicitado_en: { sale: 'solicitado_en' },
    gracia_hasta: { sale: 'gracia_hasta' },
    inmediato: { sale: 'inmediato' },
    purgado_en: { sale: 'purgado_en' },
    created_at: { sale: 'creado_en' },
    estado: { sale: 'estado' },
    pedida_por_centro: { sale: 'pedida_por_centro' },
    confirmada_en: { sale: 'confirmada_en' },
    confirmada_por: NS_PERSONA,
    rechazada_en: { sale: 'rechazada_en' },
    rechazada_por: NS_PERSONA,
    motivo_rechazo: { sale: 'motivo_rechazo' },
    retirada_en: { sale: 'retirada_en' },
    retirada_por: NS_PERSONA,
    nota_centro: { sale: 'nota_centro' },
    estado_previo: PD,
    tutores_legales: NS_PERSONA,
    por_plazo: PD,
  }),
  'usuario.perfiles_familia': seccion('familia_tutores', {
    id: NS_ID,
    familia_id: { sale: 'familia_id' },
    usuario_id: NS_SUJETO,
    rol_familia: { sale: 'rol_familia' },
    email: { sale: 'email' },
    nombre_completo: { sale: 'nombre_completo' },
    dni_documento_path: { sale: 'dni_documento_path' },
    direccion_calle: { sale: 'direccion_calle' },
    direccion_numero: { sale: 'direccion_numero' },
    direccion_cp: { sale: 'direccion_cp' },
    direccion_ciudad: { sale: 'direccion_ciudad' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    centro_id: NS_CENTRO,
  }),
  'usuario.mandatos_sepa': seccion('mandatos_sepa', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    nino_id: NS_FUERA,
    usuario_id: NS_SUJETO,
    identificador_mandato: { sale: 'identificador_mandato' },
    titular: { sale: 'titular' },
    documento_path: { sale: 'documento_path' },
    estado: { sale: 'estado' },
    firma_imagen: { sale: 'firma_imagen' },
    nombre_tecleado: { sale: 'nombre_tecleado' },
    texto_hash: { sale: 'texto_hash' },
    ip_address: { sale: 'ip_firma' },
    user_agent: { sale: 'navegador_firma' },
    fecha_firma: { sale: 'fecha_firma' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    iban_cifrado: NS_IBAN,
    metodo_firma: { sale: 'metodo_firma' },
    familia_id: { sale: 'familia_id' },
    iban_ultimos4: { sale: 'iban_ultimos4' },
  }),
  'usuario.cobros_familia.recibos.lineas': seccion('lineas_recibo', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    recibo_id: NS_ANIDADA,
    concepto_id: NS_FUERA,
    descripcion: { sale: 'descripcion' },
    cantidad: { sale: 'cantidad' },
    precio_unitario_centimos: { sale: 'precio_unitario_centimos' },
    importe_centimos: { sale: 'importe_centimos' },
    created_at: { sale: 'creado_en' },
    nino_id: NS_FUERA,
    origen: PD,
    beca_tramo_id: NS_FUERA,
    arrastre_de_recibo_id: { sale: 'arrastre_de_recibo_id' },
    sobrante_de_desborde_id: { sale: 'sobrante_de_desborde_id' },
  }),
  'usuario.cobros_familia.recibos': seccion('recibos', {
    id: { sale: 'id' },
    centro_id: {
      noSale:
        'Clave interna (uuid) del centro que emite el recibo. El centro es el responsable del tratamiento, no un dato de la familia: quién es lo dice el aviso de privacidad.',
    },
    nino_id: {
      noSale:
        'Columna del modelo anterior, cuando el recibo era de un niño. Desde la serie F el recibo es de la familia y la columna es informativa (ADR-0052); medido el 2026-11-01, ningún recibo la tiene. El niño de cada cargo sale en las líneas del export de cada niño (`lineas_recibo`).',
    },
    anio: { sale: 'anio' },
    mes: { sale: 'mes' },
    metodo: { sale: 'metodo' },
    estado: { sale: 'estado' },
    total_centimos: { sale: 'total_centimos' },
    es_esporadico: { sale: 'es_esporadico' },
    concepto_esporadico: { sale: 'concepto_esporadico' },
    devuelto_de_recibo_id: { sale: 'regiro_de' },
    fecha_envio_banco: { sale: 'fecha_envio_banco' },
    created_at: { sale: 'creado_en', nota: SUSTITUYE_467 },
    updated_at: { sale: 'actualizado_en', nota: SUSTITUYE_467 },
    deleted_at: { sale: 'borrado_en', nota: SUSTITUYE_467 },
    fecha_devolucion: { sale: 'fecha_devolucion' },
    familia_id: {
      noSale:
        'Clave interna (uuid) de la familia. El recibo ya sale dentro de su familia, en `cobros_familia`, con su etiqueta.',
    },
    cobro_forma: { sale: 'cobro_forma' },
    cobro_fecha: { sale: 'cobro_fecha' },
    cobro_nota: { sale: 'cobro_nota' },
    cobro_importe_centimos: { sale: 'cobro_importe_centimos' },
    diferencia_de_recibo_id: { sale: 'diferencia_de' },
    devolucion_gastos_centimos: { sale: 'devolucion_gastos_centimos' },
    devolucion_salida: { sale: 'devolucion_salida' },
    deuda_perdida_en: {
      noSale:
        'Decisión de Jose del 2026-11-01. Es la fecha en que el centro renunció a cobrar el recibo, y el centro solo renuncia a una deuda para poder ejecutar el olvido de alguien (20261212120000). Si saliera, el tutor que pide sus datos podría deducir que otro tutor de su familia ejerció su derecho de olvido. El art. 15.4 del RGPD dice que el derecho a obtener copia no afectará negativamente a los derechos y libertades de otros. Contrapartida, sin maquillar: el interesado ve en su export un recibo sin pagar, en el estado que tenía (la renuncia no lo cambia), que en realidad nadie le va a reclamar. Es una decisión con coste, no una decisión limpia.',
    },
    deuda_perdida_por: {
      noSale:
        'Quién de Dirección renunció a cobrarlo: es un dato de esa persona, no de la familia. Y que hubo renuncia no sale por el art. 15.4 del RGPD (ver `deuda_perdida_en`).',
    },
    deuda_perdida_solicitud_id: {
      noSale:
        'Clave interna de la petición de olvido por la que el centro renunció a la deuda. Esa petición puede ser de otra persona de la familia: enlazarla diría de quién es una petición ajena. Las peticiones propias salen en `solicitudes_olvido`.',
    },
    fecha_cobro_banco: { sale: 'fecha_cobro_banco' },
  }),
  'usuario.cobros_familia.metodos_pago': seccion('metodo_pago_familia', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    anio: { sale: 'anio' },
    mes: { sale: 'mes' },
    metodo: { sale: 'metodo' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    familia_id: NS_ANIDADA,
  }),
  'usuario.cobros_familia.conceptos_asignados': seccion('asignacion_concepto', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    concepto_id: NS_FUERA,
    nino_id: NS_FUERA,
    familia_id: NS_ANIDADA,
    cantidad_default: { sale: 'cantidad' },
    importe_override_centimos: { sale: 'importe_especial_centimos' },
    origen: PD,
    vigencia_desde: { sale: 'vigencia_desde' },
    vigencia_hasta: { sale: 'vigencia_hasta' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    porcentaje_override_bp: { sale: 'porcentaje_especial_bp' },
  }),
  'usuario.cobros_familia.beca_comedor_excesos': seccion('beca_comedor_desborde', {
    id: { sale: 'id' },
    centro_id: NS_CENTRO,
    recibo_id: { sale: 'recibo_id' },
    familia_id: NS_ANIDADA,
    anio: { sale: 'anio' },
    mes: { sale: 'mes' },
    cuota_total_centimos: { sale: 'cuota_total_centimos' },
    beca_total_centimos: { sale: 'beca_total_centimos' },
    exceso_centimos: { sale: 'exceso_centimos' },
    estado: { sale: 'estado' },
    via: { sale: 'via' },
    resuelto_por: NS_PERSONA,
    resuelto_at: { sale: 'resuelto_en' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    origen: { sale: 'origen' },
  }),
  'usuario.cobros_familia.beca_comedor_transferencias': seccion('beca_comedor_transferencia', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    recibo_id: { sale: 'recibo_id' },
    familia_id: NS_ANIDADA,
    anio: { sale: 'anio' },
    mes: { sale: 'mes' },
    importe_centimos: { sale: 'importe_centimos' },
    estado: { sale: 'estado' },
    realizada_por: NS_PERSONA,
    realizada_at: { sale: 'realizada_en' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    origen: { sale: 'origen' },
  }),
  'usuario.cobros_familia': seccion('familias', {
    id: { sale: 'id' },
    centro_id: NS_CENTRO,
    etiqueta: { sale: 'familia' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    deleted_reason: { sale: 'motivo_borrado' },
    metodo_pago: { sale: 'metodo_pago' },
    metodo_pago_manual: PD,
  }),
  'nino.lista_espera': seccion('lista_espera', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    curso_academico_id: NS_FUERA,
    nombre_nino: { sale: 'nombre_nino' },
    fecha_nacimiento: { sale: 'fecha_nacimiento' },
    telefono_tutor: { sale: 'telefono_tutor' },
    email_tutor: { sale: 'email_tutor' },
    nota: { sale: 'nota' },
    posicion: { sale: 'posicion' },
    estado: { sale: 'estado' },
    created_at: { sale: 'apuntado_en' },
    updated_at: { sale: 'actualizado_en' },
    apellidos_nino: { sale: 'apellidos_nino' },
    tutor_usuario_id: NS_PERSONA,
    nino_id: NS_SUJETO,
    descartado_at: PD,
  }),
  'nino.matriculas': seccion('matriculas', {
    id: { sale: 'id' },
    nino_id: NS_SUJETO,
    aula_id: NS_FUERA,
    curso_academico_id: NS_FUERA,
    estado: { sale: 'estado' },
    fecha_alta: { sale: 'fecha_alta' },
    fecha_baja: { sale: 'fecha_baja' },
    motivo_baja: PD,
    created_at: { sale: 'creado_en' },
    deleted_at: { sale: 'borrado_en' },
    activada_at: { sale: 'activada_en' },
  }),
  'nino.consentimientos': seccion('consentimientos', {
    id: NS_ID,
    usuario_id: NS_PERSONA,
    tipo: { sale: 'tipo' },
    version: { sale: 'version_texto' },
    aceptado_en: { sale: 'aceptado_en' },
    ip_address: NS_IP_OTROS,
    user_agent: NS_IP_OTROS,
    created_at: { sale: 'creado_en' },
    revocado_en: { sale: 'revocado_en' },
    metodo_firma: { sale: 'metodo_firma' },
    nino_id: NS_SUJETO,
  }),
  'nino.acuses_alta': seccion('acuses_alta', {
    id: NS_ID,
    nino_id: NS_SUJETO,
    centro_id: NS_CENTRO,
    tipo: { sale: 'tipo' },
    firmante_id: NS_PERSONA,
    aceptado_en: { sale: 'aceptado_en' },
    metodo: { sale: 'metodo' },
  }),
  'nino.cambios_solicitados': seccion('cambios_pendientes', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    nino_id: NS_SUJETO,
    entidad: { sale: 'entidad' },
    registro_id: NS_FUERA,
    campo: { sale: 'campo' },
    payload: { sale: 'detalle' },
    valor_propuesto: { sale: 'valor_propuesto' },
    estado: { sale: 'estado' },
    solicitado_por: NS_PERSONA,
    revisado_por: NS_PERSONA,
    created_at: { sale: 'solicitado_en' },
    decided_at: { sale: 'decidido_en' },
  }),
  'nino.fin_de_curso': seccion('rollover_finaliza', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    curso_academico_id: NS_FUERA,
    nino_id: NS_SUJETO,
    created_at: { sale: 'registrado_en' },
    created_by: NS_PERSONA,
  }),
  'nino.citas': seccion('citas', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    tipo: { sale: 'tipo' },
    organizador_id: NS_PERSONA,
    titulo: { sale: 'titulo' },
    descripcion: { sale: 'descripcion' },
    lugar: { sale: 'lugar' },
    fecha: { sale: 'fecha' },
    hora_inicio: { sale: 'hora_inicio' },
    hora_fin: { sale: 'hora_fin' },
    aula_id: NS_FUERA,
    nino_id: NS_SUJETO,
    estado: { sale: 'estado' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.eventos': seccion('eventos', {
    id: { sale: 'id' },
    centro_id: NS_CENTRO,
    ambito: PD,
    aula_id: NS_FUERA,
    nino_id: NS_SUJETO,
    tipo: { sale: 'tipo' },
    titulo: { sale: 'titulo' },
    descripcion: { sale: 'descripcion' },
    lugar: { sale: 'lugar' },
    fecha: { sale: 'fecha' },
    fecha_fin: { sale: 'fecha_fin' },
    hora_inicio: { sale: 'hora_inicio' },
    hora_fin: { sale: 'hora_fin' },
    requiere_confirmacion: PD,
    estado: { sale: 'estado' },
    creado_por: NS_PERSONA,
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.confirmaciones_eventos': seccion('confirmaciones_evento', {
    id: NS_ID,
    evento_id: { sale: 'evento_id' },
    nino_id: NS_SUJETO,
    estado: { sale: 'estado' },
    comentario: { sale: 'comentario' },
    confirmado_por: NS_PERSONA,
    confirmado_at: { sale: 'confirmado_at' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.recordatorios': seccion('recordatorios', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    destinatario: PD,
    nino_id: NS_SUJETO,
    aula_id: NS_FUERA,
    usuario_destinatario_id: NS_PERSONA,
    creado_por: NS_PERSONA,
    titulo: { sale: 'titulo' },
    descripcion: { sale: 'descripcion' },
    vencimiento: { sale: 'vencimiento' },
    completado_en: { sale: 'completado_en' },
    completado_por: NS_PERSONA,
    erroneo: PD,
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.conceptos_asignados': seccion('asignacion_concepto', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    concepto_id: NS_FUERA,
    nino_id: NS_SUJETO,
    familia_id: NS_FUERA,
    cantidad_default: { sale: 'cantidad' },
    importe_override_centimos: { sale: 'importe_especial_centimos' },
    origen: PD,
    vigencia_desde: { sale: 'vigencia_desde' },
    vigencia_hasta: { sale: 'vigencia_hasta' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
    deleted_at: { sale: 'borrado_en' },
    porcentaje_override_bp: { sale: 'porcentaje_especial_bp' },
  }),
  'nino.lineas_recibo': seccion('lineas_recibo', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    recibo_id: NS_FUERA,
    concepto_id: NS_FUERA,
    descripcion: { sale: 'descripcion' },
    cantidad: { sale: 'cantidad' },
    precio_unitario_centimos: PD,
    importe_centimos: { sale: 'importe_centimos' },
    created_at: { sale: 'creado_en' },
    nino_id: NS_SUJETO,
    origen: PD,
    beca_tramo_id: { sale: 'beca_tramo_id' },
    arrastre_de_recibo_id: NS_FUERA,
    sobrante_de_desborde_id: NS_FUERA,
  }),
  'nino.servicios_diarios': seccion('parte_servicio_diario', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    nino_id: NS_SUJETO,
    fecha: { sale: 'fecha' },
    servicio: { sale: 'servicio' },
    presente: { sale: 'presente' },
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.beca_comedor_elegibilidad': seccion('beca_comedor_elegibilidad', {
    id: NS_ID,
    centro_id: NS_CENTRO,
    nino_id: NS_SUJETO,
    curso_academico_id: NS_FUERA,
    activa: { sale: 'activa' },
    fecha_alta: { sale: 'fecha_alta' },
    fecha_baja: { sale: 'fecha_baja' },
    created_by: NS_PERSONA,
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.beca_comedor_tramos': seccion('beca_comedor_tramo', {
    id: { sale: 'id' },
    centro_id: NS_CENTRO,
    nino_id: NS_SUJETO,
    curso_academico_id: NS_FUERA,
    anio_correspondiente: { sale: 'anio_correspondiente' },
    mes_correspondiente: { sale: 'mes_correspondiente' },
    anio_aplicacion: { sale: 'anio_aplicacion' },
    mes_aplicacion: { sale: 'mes_aplicacion' },
    importe_centimos: { sale: 'importe_centimos' },
    estado: { sale: 'estado' },
    origen: { sale: 'origen' },
    tramo_padre_id: { sale: 'tramo_padre_id' },
    aplicada_en_recibo_id: NS_FUERA,
    created_by: NS_PERSONA,
    created_at: { sale: 'creado_en' },
    updated_at: { sale: 'actualizado_en' },
  }),
  'nino.solicitudes_olvido': seccion('olvido_solicitudes', {
    id: NS_ID,
    sujeto_tipo: PD,
    sujeto_id: NS_SUJETO,
    centro_id: NS_CENTRO,
    solicitado_por: NS_PERSONA,
    solicitado_en: { sale: 'solicitado_en' },
    gracia_hasta: { sale: 'gracia_hasta' },
    inmediato: { sale: 'inmediato' },
    purgado_en: { sale: 'purgado_en' },
    created_at: { sale: 'creado_en' },
    estado: { sale: 'estado' },
    pedida_por_centro: { sale: 'pedida_por_centro' },
    confirmada_en: { sale: 'confirmada_en' },
    confirmada_por: NS_PERSONA,
    rechazada_en: { sale: 'rechazada_en' },
    rechazada_por: NS_PERSONA,
    motivo_rechazo: { sale: 'motivo_rechazo' },
    retirada_en: { sale: 'retirada_en' },
    retirada_por: NS_PERSONA,
    nota_centro: { sale: 'nota_centro' },
    estado_previo: PD,
    tutores_legales: NS_PERSONA,
    por_plazo: PD,
  }),
  'nino.lecturas_ficha_medica': seccion('lecturas_ficha_medica', {
    id: NS_ID,
    nino_id: NS_SUJETO,
    centro_id: NS_CENTRO,
    lector_id: NS_PERSONA,
    rol_lector: { sale: 'rol_lector' },
    origen: { sale: 'origen' },
    campos: { sale: 'campos' },
    leida_en: { sale: 'leida_en' },
  }),
} satisfies Record<string, SeccionExport>
