// Lista base del guard check-centro-activo (multicentro · Fase 1). GENERADA y revisada a mano.
// Cada PR de la sustitución BORRA entradas de PENDIENTES_*: el guard falla si una entrada ya no
// hace falta (lista rancia) o si aparece un uso nuevo que no está aquí.

/**
 * Ficheros que aún usan getCentroActualId / getRolEnCentro (deprecadas), con cuántas veces las
 * nombran (import + llamadas, sin comentarios). Solo puede BAJAR; vacía en el PR5.
 */
export const PENDIENTES_GET_CENTRO = {
  'src/app/[locale]/admin/admisiones/page.tsx': 2,
  'src/app/[locale]/admin/audit/page.tsx': 2,
  'src/app/[locale]/admin/aulas/page.tsx': 2,
  'src/app/[locale]/admin/autorizaciones/[id]/page.tsx': 4,
  'src/app/[locale]/admin/autorizaciones/page.tsx': 4,
  'src/app/[locale]/admin/calendario/page.tsx': 4,
  'src/app/[locale]/admin/centro/page.tsx': 2,
  'src/app/[locale]/admin/cuotas/page.tsx': 2,
  'src/app/[locale]/admin/cuotas/recibos/csv/route.ts': 2,
  'src/app/[locale]/admin/cursos/page.tsx': 2,
  'src/app/[locale]/admin/familias/[id]/page.tsx': 2,
  'src/app/[locale]/admin/familias/page.tsx': 2,
  'src/app/[locale]/admin/fotos-revocadas/[ninoId]/page.tsx': 2,
  'src/app/[locale]/admin/fotos-revocadas/page.tsx': 2,
  'src/app/[locale]/admin/informes/campanas/page.tsx': 4,
  'src/app/[locale]/admin/informes/page.tsx': 4,
  'src/app/[locale]/admin/menus/[id]/page.tsx': 4,
  'src/app/[locale]/admin/menus/page.tsx': 4,
  'src/app/[locale]/admin/ninos/page.tsx': 2,
  'src/app/[locale]/admin/page.tsx': 2,
  'src/app/[locale]/admin/pasar-de-curso/page.tsx': 2,
  'src/app/[locale]/admin/personal/page.tsx': 2,
  'src/app/[locale]/agenda/page.tsx': 4,
  'src/app/[locale]/alta/[ninoId]/page.tsx': 2,
  'src/app/[locale]/family/autorizaciones/[id]/page.tsx': 4,
  'src/app/[locale]/family/autorizaciones/page.tsx': 4,
  'src/app/[locale]/family/calendario/page.tsx': 4,
  'src/app/[locale]/family/page.tsx': 2,
  'src/app/[locale]/messages/conversacion/[id]/page.tsx': 4,
  'src/app/[locale]/messages/nuevo-anuncio/page.tsx': 4,
  'src/app/[locale]/messages/page.tsx': 4,
  'src/app/[locale]/reminders/page.tsx': 4,
  'src/app/[locale]/teacher/aula/[id]/comida/page.tsx': 4,
  'src/app/[locale]/teacher/aula/[id]/fotos/page.tsx': 2,
  'src/app/[locale]/teacher/aula/[id]/page.tsx': 2,
  'src/app/[locale]/teacher/aula/[id]/servicio/page.tsx': 2,
  'src/app/[locale]/teacher/autorizaciones/[id]/page.tsx': 4,
  'src/app/[locale]/teacher/autorizaciones/page.tsx': 4,
  'src/app/[locale]/teacher/calendario/page.tsx': 4,
  'src/app/[locale]/teacher/informes/[id]/page.tsx': 4,
  'src/app/[locale]/teacher/informes/page.tsx': 4,
  'src/app/[locale]/teacher/page.tsx': 2,
  'src/features/autorizaciones/actions/gestionar-autorizacion.ts': 2,
  'src/features/beca-comedor/actions/cargas-beca.ts': 4,
  'src/features/beca-comedor/actions/elegibilidad.ts': 2,
  'src/features/beca-comedor/actions/resolver-desborde.ts': 2,
  'src/features/beca-comedor/actions/transferencias.ts': 2,
  'src/features/cierre-cobros/actions/crear-recibo-esporadico.ts': 2,
  'src/features/conceptos-cobro/actions/tarifa-concepto-anio.ts': 3,
  'src/features/cuotas-config/actions/proponer-asignaciones.ts': 2,
  'src/features/cuotas-config/actions/reproponer-asignaciones.ts': 2,
  'src/features/familias/actions/editar-etiqueta-familia.ts': 2,
  'src/features/familias/actions/editar-perfil-tutor.ts': 2,
  'src/features/familias/actions/gestionar-domiciliacion-familia.ts': 2,
  'src/features/fotos/queries/get-publicaciones-aula.ts': 2,
  'src/features/informes/actions/gestionar-campana-informe.ts': 2,
  'src/features/informes/actions/gestionar-informe.ts': 2,
  'src/features/informes/actions/gestionar-plantilla-informe.ts': 2,
  'src/features/informes/actions/publicar-lote-informes.ts': 2,
  'src/features/informes/queries/get-informes-profe.ts': 2,
  'src/features/informes/queries/get-pendientes-campana-profe.ts': 2,
  'src/features/lista-espera/actions/completar-direccion.ts': 2,
  'src/features/lista-espera/actions/crear-prospecto.ts': 2,
  'src/features/lista-espera/actions/invitar-al-alta.ts': 2,
  'src/features/lista-espera/actions/resolver-tutor.ts': 2,
  'src/features/messaging/actions/publicar-anuncio.ts': 4,
  'src/features/messaging/queries/count-no-leidos.ts': 4,
  'src/features/recibos/actions/generar-recibos-mes.ts': 2,
  'src/features/recibos/actions/lineas-recibo.ts': 2,
  'src/features/recibos/actions/recalcular-mes.ts': 2,
  'src/features/recibos/actions/set-metodo-pago-familia.ts': 2,
  'src/features/remesas/actions/crear-regiro.ts': 2,
  'src/features/remesas/actions/crear-remesa.ts': 2,
  'src/features/remesas/actions/guardar-datos-acreedor.ts': 2,
  'src/features/remesas/actions/marcar-cobrado-manual.ts': 2,
  'src/features/remesas/actions/marcar-recibo-devuelto.ts': 2,
  'src/features/remesas/actions/marcar-remesa-enviada.ts': 2,
  'src/features/remesas/actions/registrar-gastos-devolucion.ts': 2,
}

/**
 * Lecturas de `roles_usuario` que NO son «el centro del usuario actual» y se quedan: miran a OTRO
 * usuario, clasifican una cuenta o cuentan el personal de un centro explícito. `n` = cuántas
 * lecturas de ese tipo hay en el fichero.
 */
export const LECTURAS_PERMITIDAS = {
  'src/proxy.ts': {
    n: 1,
    motivo: 'gatea el prefijo de ruta con los roles de cualquier centro; lo revisa la Fase 3',
  },
  'src/app/[locale]/admin/page.tsx': { n: 1, motivo: 'cuenta el personal de un centro explícito' },
  'src/app/[locale]/usuarios/[id]/avatar/route.ts': {
    n: 1,
    motivo: 'centros del usuario DESTINO (service role)',
  },
  'src/features/auth/actions/accept-invitation.ts': {
    n: 6,
    motivo: 'clasifica la cuenta invitada e inserta/retira su rol (service role)',
  },
  'src/features/auth/lib/crear-tutor-directo.ts': { n: 1, motivo: 'clasifica una cuenta ajena' },
  'src/features/auth/lib/detectar-cuenta-email.ts': { n: 1, motivo: 'clasifica una cuenta ajena' },
  'src/features/lista-espera/lib/resolver-tutor-email.ts': {
    n: 1,
    motivo: 'clasifica una cuenta ajena (D4: global a propósito; lo revisa la Fase 4)',
  },
  'src/features/lista-espera/actions/completar-direccion.ts': {
    n: 1,
    motivo: 'clasifica una cuenta ajena',
  },
  'src/features/lista-espera/actions/invitar-al-alta.ts': {
    n: 1,
    motivo: 'clasifica una cuenta ajena',
  },
  'src/features/export/lib/recolectar.ts': { n: 1, motivo: 'export art. 15 del sujeto' },
  'src/features/olvido/lib/fuentes-adjuntos.ts': {
    n: 1,
    motivo: 'purga RGPD del sujeto (service role)',
  },
  'src/features/messaging/queries/get-conversacion-detalle.ts': {
    n: 1,
    motivo: 'roles de los autores de los mensajes',
  },
  'src/features/profes-aulas/queries/get-profes-candidatos.ts': {
    n: 1,
    motivo: 'profes de un centro explícito',
  },
  'src/shared/lib/audiencia-personas.ts': { n: 1, motivo: 'profes de un centro explícito' },
  'src/features/profes-aulas/actions/asignar-profe-aula.ts': {
    n: 1,
    motivo: 'rol del profe al que se asigna',
  },
  'src/features/vinculos/actions/crear-vinculo.ts': {
    n: 1,
    motivo: 'rol del usuario al que se vincula',
  },
}

/**
 * Lecturas de `roles_usuario` del usuario ACTUAL que tienen que pasar por el contexto
 * (`requireContextoCentro` / `contextoEnCentro`). Solo puede BAJAR, hasta vaciarse.
 */
export const LECTURAS_PENDIENTES = {
  'src/app/[locale]/usuarios/[id]/avatar/route.ts': 2,
  'src/features/agenda/lib/server-helpers.ts': 1,
  'src/features/eventos/lib/server-helpers.ts': 1,
  'src/features/recordatorios/actions/crear-recordatorio.ts': 1,
  'src/features/auth/actions/invitar-profe.ts': 1,
  'src/features/messaging/actions/abrir-conversacion-admin-familia.ts': 1,
  'src/features/auth/actions/send-invitation.ts': 1,
  'src/features/lista-espera/actions/completar-direccion.ts': 1,
  'src/features/lista-espera/actions/invitar-al-alta.ts': 1,
  'src/features/lista-espera/lib/authz-admisiones.ts': 1,
  'src/features/familias/actions/editar-perfil-tutor.ts': 1,
  'src/features/familias/actions/editar-etiqueta-familia.ts': 1,
  'src/features/familias/actions/gestionar-domiciliacion-familia.ts': 1,
  'src/features/alta/lib/authz-tutor.ts': 1,
  'src/features/messaging/queries/get-aulas-para-anuncio.ts': 1,
}
