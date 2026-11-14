/**
 * La fecha de incorporación de los niños de test (serie de altas, fase 8a): anterior a cualquier mes
 * que genere un test, para que el motor de recibos los cobre como antes de la fase, «incorporados desde
 * siempre».
 *
 * Vive aquí y no en `setup.ts` porque NO es una fecha del curso: no se queda atrás cuando pasa el
 * tiempo, al contrario que las del curso (que salen de `cursoDeTest`). El centinela
 * `src/test/guards/curso-de-test.test.ts` prohíbe fechas escritas a mano en `setup.ts`, y no debe
 * aprender a distinguir esta de las del curso.
 */
export const FECHA_INCORPORACION_DE_TEST = '2000-01-01'
