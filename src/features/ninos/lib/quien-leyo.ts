import type { LecturaFichaMedica } from '../queries/get-lecturas-ficha-medica'

/**
 * Quién leyó, como se enseña en la pantalla del registro y en el imprimible, las dos vías con la
 * misma raya (R4, decisión de Jose del 2026-11-01, por quién mira y no por qué pantalla): el
 * nombre si se puede dar; el rol si quien mira es un tutor y quien leyó es del personal del centro;
 * «cuenta borrada» si ya no existe. `t` es el traductor del namespace `ficha_medica_lecturas`.
 */
export function quienLeyo(l: LecturaFichaMedica, t: (key: string) => string): string {
  switch (l.lector.tipo) {
    case 'nombre':
      return l.lector.nombre
    case 'oculto':
      return t(`rol.${l.rol}`)
    case 'cuenta_borrada':
      return t('cuenta_borrada')
    default: {
      const _exhaustivo: never = l.lector
      return _exhaustivo
    }
  }
}
