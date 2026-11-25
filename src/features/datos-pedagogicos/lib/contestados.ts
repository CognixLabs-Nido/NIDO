/**
 * ¿Están contestados los datos pedagógicos? Solo con los TRES que decide la comida contestados:
 * lactancia, esfínteres y alimentación (C, 2026-11-24). Una fila con solo la siesta existe, pero no
 * es «hecho»: el ✓ del avance del alta mentiría, y el pase de comidas dice «sin datos pedagógicos».
 */
export function datosPedagogicosContestados(
  datos: {
    lactancia_estado: string | null
    control_esfinteres: string | null
    tipo_alimentacion: string | null
  } | null
): boolean {
  return (
    datos !== null &&
    datos.lactancia_estado !== null &&
    datos.control_esfinteres !== null &&
    datos.tipo_alimentacion !== null
  )
}
