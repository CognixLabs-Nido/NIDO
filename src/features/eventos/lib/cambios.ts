/**
 * Campos **materiales** de un evento: los que cambian *cuándo* o *dónde* hay
 * que acudir. Una edición de estos re-notifica a la audiencia; una de
 * título/descripción/tipo (corrección de texto) NO.
 */
export interface CamposMaterialesEvento {
  fecha: string
  fecha_fin: string | null
  hora_inicio: string | null
  hora_fin: string | null
  lugar: string | null
}

/** Postgres devuelve `time` como 'HH:MM:SS'; el formulario manda 'HH:MM'. */
function normHora(h: string | null): string | null {
  return h ? h.slice(0, 5) : null
}

/**
 * ¿Cambió algún campo material entre el estado previo y el nuevo?
 *
 * Compara fecha, fecha_fin, hora_inicio, hora_fin y lugar, normalizando las
 * horas para no marcar un falso positivo por el sufijo ':SS' que añade
 * Postgres. Título/descripción/tipo quedan deliberadamente fuera: no afectan
 * a la logística de asistencia (ver Regla #11, F7).
 */
export function huboCambioMaterial(
  previo: CamposMaterialesEvento,
  nuevo: CamposMaterialesEvento
): boolean {
  return (
    previo.fecha !== nuevo.fecha ||
    (previo.fecha_fin ?? null) !== (nuevo.fecha_fin ?? null) ||
    normHora(previo.hora_inicio) !== normHora(nuevo.hora_inicio) ||
    normHora(previo.hora_fin) !== normHora(nuevo.hora_fin) ||
    (previo.lugar ?? null) !== (nuevo.lugar ?? null)
  )
}
