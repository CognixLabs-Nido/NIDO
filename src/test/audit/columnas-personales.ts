/**
 * Las columnas personales que comparten varios tests de purga, decididas UNA vez. Cada lista va con
 * sus excluidas y su porqué, y un test las compara con las columnas vivas de la base
 * (`expectColumnasDecididas`): una columna nueva en la tabla no pasa en verde hasta que alguien
 * decide si es personal.
 *
 * - `info_medica_emergencia`: la comprueba `purga-rgpd-nino.test.ts` (está en sus CLAVES) y la usa
 *   también `olvido-funcional.rls.test.ts`.
 * - `familia_tutores`: la comprueba `purga-cierre.test.ts` y la usa también
 *   `olvido-por-centro.test.ts`.
 */

/** Los seis campos de la ficha médica, cifrados: la purga del niño los deja a NULL. */
export const PERSONALES_INFO_MEDICA = [
  'alergias_graves',
  'notas_emergencia',
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
  'telefono_emergencia',
] as const

export const NO_PERSONALES_INFO_MEDICA: Readonly<Record<string, string>> = {
  id: 'identificador de la fila, sin dato de nadie',
  nino_id: 'el niño, por su id: la fila se queda con el niño seudonimizado',
  created_at: 'fecha técnica de la fila',
  updated_at: 'fecha técnica de la fila',
}

/** El perfil del adulto en su familia: la purga del usuario lo deja a NULL (las dos ramas). */
export const PERSONALES_FAMILIA_TUTORES = [
  'nombre_completo',
  'email',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  'dni_documento_path',
  // Fase 6 (20270118120000, 2026-11-13).
  'telefono',
  'fecha_nacimiento',
  'dni_numero',
  'estudios',
  'empresa',
] as const

export const NO_PERSONALES_FAMILIA_TUTORES: Readonly<Record<string, string>> = {
  id: 'identificador de la fila, sin dato de nadie',
  usuario_id: 'seudónimo: la purga lo conserva (el trigger lo congela) para el histórico fiscal',
  familia_id: 'seudónimo: la purga lo conserva para el histórico fiscal de la familia',
  centro_id: 'el centro, derivado de la familia; no identifica a la persona',
  rol_familia: 'categórico (titular o segundo tutor); la purga lo conserva',
  created_at: 'fecha técnica de la fila',
  updated_at: 'fecha técnica de la fila',
  deleted_at: 'la baja de la fila; la purga la pone',
}

/** Una consulta con todas las columnas de una lista, para un `.select()`. */
export const columnas = (lista: readonly string[]) => lista.join(', ')

/** `{ columna: valor }` con el mismo valor para todas: lo esperado tras una purga. */
export const todasA = <V>(lista: readonly string[], valor: V) =>
  Object.fromEntries(lista.map((c) => [c, valor])) as Record<string, V>
