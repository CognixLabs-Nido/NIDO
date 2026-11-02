/**
 * Las columnas que `recolectar.ts` sacaba el 2026-11-01 con `select('*')` sin que nadie las hubiera
 * repasado (`saleSinRepasar` en `columnas-recolectar.ts`). La lista solo mengua: cada una que se
 * repasa sale de aquí, y una columna nueva no puede entrar.
 */
export const SALE_SIN_REPASAR_2026_11_01: readonly string[] = ['nino.firmas.comentario']
