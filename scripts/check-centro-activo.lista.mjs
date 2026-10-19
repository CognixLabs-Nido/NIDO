// Lista base del guard check-centro-activo (multicentro · Fase 1). GENERADA y revisada a mano.
// Cada PR de la sustitución BORRA entradas de PENDIENTES_*: el guard falla si una entrada ya no
// hace falta (lista rancia) o si aparece un uso nuevo que no está aquí.

/**
 * Ficheros que aún usan getCentroActualId / getRolEnCentro (deprecadas), con cuántas veces las
 * nombran (import + llamadas, sin comentarios). Solo puede BAJAR; vacía en el PR5.
 */
export const PENDIENTES_GET_CENTRO = {
  'src/features/autorizaciones/actions/gestionar-autorizacion.ts': 2,
  'src/features/informes/actions/gestionar-campana-informe.ts': 2,
  'src/features/informes/actions/gestionar-informe.ts': 2,
  'src/features/informes/actions/gestionar-plantilla-informe.ts': 2,
  'src/features/informes/actions/publicar-lote-informes.ts': 2,
  'src/features/lista-espera/actions/crear-prospecto.ts': 2,
  'src/features/lista-espera/actions/resolver-tutor.ts': 2,
  'src/features/messaging/actions/publicar-anuncio.ts': 4,
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
export const LECTURAS_PENDIENTES = {}
