import type { BloqueAlta } from '@/features/alta/actions/finalizar-alta'
import {
  frenaElAlta,
  hayObligatorioSubido,
  type DocumentoEnElCierre,
} from '@/features/alta/lib/regla-documentos-alta'

/**
 * Lo que lleva hecho un alta, sacado de lo que ya está guardado (decisión de Jose, 2026-11-04:
 * «lo que llevan hecho, no dónde se pararon»). Es lo que mira la directora para decidir si llama,
 * así que cada línea solo dice «hecho» por algo que **hizo la familia**, nunca por un dato que ya
 * venía puesto:
 *
 *  - El nombre, los apellidos y la fecha de nacimiento del niño los pone la invitación
 *    (`crear_o_anadir_a_familia`). Por eso «Datos del niño» no mira la identidad (la tarjeta de la
 *    ficha la marcaba hecha desde el principio).
 *  - Lo obligatorio que la familia hace en cada paso es otra cosa: en el del niño, subir el libro de
 *    familia y, desde la fase 7 (2026-11-13), el número de la tarjeta sanitaria; en el del tutor 1, desde la fase 6 (2026-11-13), sus datos enteros y su DNI
 *    (`tutorCompleto`), que es lo que exige el cierre. El nombre solo, que pone aceptar la invitación,
 *    no lo hace «hecho».
 *
 *  - Los documentos del centro (fase 4, 4b-2) con la regla del gate (`regla-documentos-alta.ts`):
 *    hecho si no queda ninguno obligatorio por firmar. Si no hay ninguno obligatorio subido, la línea
 *    no sale: el centro aún no ha subido nada y la familia no tiene nada que hacer (como el SEPA sin
 *    CID), y «hecho» diría lo contrario.
 *
 * Una línea por paso del wizard, en su orden. `opcional`: no impide terminar el alta; sin hacer se
 * pinta neutra, no como lo que falta.
 */
export const ITEMS_AVANCE = [
  'documentos_centro',
  'nino',
  'imagen',
  'tutor1',
  'tutor2',
  'medico',
  'sepa',
] as const

export type ItemAvance = (typeof ITEMS_AVANCE)[number]

export const ITEMS_OPCIONALES: ReadonlySet<ItemAvance> = new Set(['tutor2', 'sepa'])

/** Las señales guardadas de un alta (las lee `get-avance-alta.ts`). */
export interface SenalesAvance {
  /** Los documentos del centro del niño (`documentos_firma_nino`): obligatorio y estado. */
  documentosCentro: readonly DocumentoEnElCierre[]
  /** `ninos.libro_familia_path`: lo sube la familia en el paso del niño. */
  libroFamilia: boolean
  /** Fase 7: el número de la tarjeta sanitaria (`sip_de_ninos`). Lo teclea la familia en el paso del niño. */
  sip: boolean
  /** Consentimiento de imagen vigente del niño (`existe_consentimiento_imagen`). */
  imagen: boolean
  /**
   * El titular, completo como lo exige el cierre (`tutorCompleto`, espejo de `privado.tutor_completo`):
   * desde la fase 6 lo rellena la familia en su paso (teléfono, fecha de nacimiento, número y PDF del
   * DNI, dirección). Antes bastaba el PDF del DNI, porque el nombre lo ponía la invitación.
   */
  tutor1: boolean
  /** El segundo tutor: no hay (opcional), completo, o empezado y a medias (frena el cierre). */
  tutor2: 'no_hay' | 'completo' | 'incompleto'
  /** Acuse de confidencialidad de los datos médicos (`consentimientos`, `datos_medicos`). */
  medico: boolean
  /** La familia tiene un mandato SEPA activo. */
  mandato: boolean
  /** Sin CID del centro el paso SEPA no aparece (0c, 2026-11-04): tampoco su línea. */
  centroConCid: boolean
}

export type EstadoItem = 'hecho' | 'falta' | 'sin_hacer_opcional'

export interface LineaAvance {
  item: ItemAvance
  estado: EstadoItem
}

/**
 * Lo que el gate de `finalizarAlta` exige, bloque a bloque, y qué línea lo enseña. `invitacion`:
 * ese bloque ya lo cumple lo que pone la invitación o aceptarla, así que no es algo que haga la
 * familia y no tiene línea. Es un `Record`: un bloque nuevo en el gate no compila hasta decir aquí
 * qué línea lo enseña.
 */
export const LINEAS_DEL_GATE: Record<BloqueAlta, readonly ItemAvance[] | 'invitacion'> = {
  identidad: 'invitacion',
  tutor1: ['tutor1'],
  tutor2: ['tutor2'],
  documentos: ['nino', 'tutor1'],
  medico: ['medico'],
  imagen: ['imagen'],
  documentos_centro: ['documentos_centro'],
}

const HECHO: Record<ItemAvance, (s: SenalesAvance) => boolean> = {
  documentos_centro: (s) => !s.documentosCentro.some(frenaElAlta),
  nino: (s) => s.libroFamilia && s.sip,
  imagen: (s) => s.imagen,
  tutor1: (s) => s.tutor1,
  tutor2: (s) => s.tutor2 === 'completo',
  medico: (s) => s.medico,
  sepa: (s) => s.mandato,
}

export function avanceAlta(s: SenalesAvance): LineaAvance[] {
  return ITEMS_AVANCE.filter(
    (item) =>
      (item !== 'sepa' || s.centroConCid) &&
      (item !== 'documentos_centro' || hayObligatorioSubido(s.documentosCentro))
  ).map((item) => ({
    item,
    estado: HECHO[item](s)
      ? 'hecho'
      : // Un segundo tutor empezado y a medias frena el cierre: no es «opcional sin hacer».
        ITEMS_OPCIONALES.has(item) && !(item === 'tutor2' && s.tutor2 === 'incompleto')
        ? 'sin_hacer_opcional'
        : 'falta',
  }))
}
