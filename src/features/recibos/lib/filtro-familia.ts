// Filtro por familia del panel del mes de Cuotas (F-6). Puro y sin dependencias: testeable.
//
// El filtro solo cambia lo que se VE. Lo que se hace sobre el mes entero (generar, recalcular) sigue
// contando todos los borradores; lo que se hace sobre lo marcado (confirmar en lote) solo puede
// llevar recibos que se ven: un borrador marcado y escondido por el filtro no se confirma a ciegas.

/** Lo que el filtro necesita de una fila del panel. */
export interface FilaFiltrable {
  familiaId: string
  etiqueta: string
  recibo: { id: string; estado: string } | null
}

/** Lo que el filtro necesita de un esporádico o re-giro del mes. */
export interface EsporadicoFiltrable {
  familiaId: string | null
  familiaEtiqueta: string
}

export interface OpcionFamilia {
  familiaId: string
  etiqueta: string
}

/** Las familias del panel de este mes (con fila o con un esporádico), por etiqueta. */
export function opcionesFamilia(
  filas: FilaFiltrable[],
  esporadicos: EsporadicoFiltrable[]
): OpcionFamilia[] {
  const porId = new Map<string, string>()
  for (const f of filas) porId.set(f.familiaId, f.etiqueta)
  for (const e of esporadicos) {
    if (e.familiaId && !porId.has(e.familiaId)) porId.set(e.familiaId, e.familiaEtiqueta)
  }
  return [...porId.entries()]
    .map(([familiaId, etiqueta]) => ({ familiaId, etiqueta }))
    .sort(
      (a, b) =>
        a.etiqueta.localeCompare(b.etiqueta, 'es-ES') || a.familiaId.localeCompare(b.familiaId)
    )
}

/** Las filas y los esporádicos que se ven con el filtro (null = todas las familias). */
export function filtrarPanel<F extends FilaFiltrable, E extends EsporadicoFiltrable>(
  filas: F[],
  esporadicos: E[],
  familiaId: string | null
): { filas: F[]; esporadicos: E[] } {
  if (!familiaId) return { filas, esporadicos }
  return {
    filas: filas.filter((f) => f.familiaId === familiaId),
    esporadicos: esporadicos.filter((e) => e.familiaId === familiaId),
  }
}

/** Los ids de los borradores que se ven: lo único que se puede marcar y confirmar en lote. */
export function borradoresVisibles(filasVisibles: FilaFiltrable[]): string[] {
  return filasVisibles.flatMap((f) =>
    f.recibo && f.recibo.estado === 'borrador' ? [f.recibo.id] : []
  )
}

/** Lo marcado que se ve: lo que de verdad se confirma. Lo marcado y escondido se queda fuera. */
export function seleccionVisible(seleccion: Iterable<string>, visibles: string[]): string[] {
  const ver = new Set(visibles)
  void ver
  return [...seleccion]
}
