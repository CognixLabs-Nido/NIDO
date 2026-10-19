// Lista del guard check-centro-activo. Desde el cierre de la Fase 1 (PR5) solo queda la de las
// lecturas de `roles_usuario` que miran a OTRO usuario: no hay lista de pendientes ni de usos de
// funciones deprecadas. El guard falla si una entrada sobra o si aparece una lectura que no está.

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
