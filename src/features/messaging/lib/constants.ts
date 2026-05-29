/** Ventana de tiempo durante la que el autor puede marcar un mensaje o anuncio
 *  como erróneo (F5.6-B). La capa autoritativa es RLS — esta constante es para
 *  el pre-check rápido que evita un round-trip cuando ya sabemos que fallará.
 *  Mantener sincronizado con la migración 20260528200000.
 *
 *  Vive fuera de los actions porque archivos con `'use server'` solo pueden
 *  exportar funciones async (Next.js 16). El cliente también la importa desde
 *  aquí para el early-return de MarcarErroneoButton.
 */
export const VENTANA_ANULACION_MS = 5 * 60 * 1000
