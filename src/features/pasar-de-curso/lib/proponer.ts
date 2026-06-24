/**
 * F11-H-2 "pasar de curso" — lógica PURA de propuesta de matrículas por edad.
 *
 * Modelo B1 (decisión usuario 2026-06-24): las salas mantienen su `tramo_edad`
 * fijo y **el niño sube de sala**. Al pasar de curso, cada niño con matrícula
 * activa en el curso saliente se propone para la sala del curso entrante cuyo
 * `tramo_edad` incluya su **año de nacimiento**.
 *
 * Casos (decisión C + ajuste H-2-1):
 *  - 1 sala candidata  → propuesta directa.
 *  - 0 salas (se sale de la franja 0-3) → **graduado** (no se propone).
 *  - ≥2 salas candidatas → **agrupación por aula de origen** (H-2-1): los niños
 *    del mismo aula de origen se mantienen juntos y van a la misma sala candidata;
 *    aulas de origen distintas se reparten en candidatas distintas (round-robin
 *    determinista). Sigue siendo una propuesta editable: la directora reasigna a
 *    mano desde la tabla cuando no le encaje.
 *  - sin fecha de nacimiento (esqueleto sin completar) → **requiere elección**
 *    (no se puede inferir la edad; la directora asigna a mano).
 *
 * Idempotente (decisión "una sola vez" + reanudable): los niños que YA tienen
 * matrícula en el curso destino se ignoran (no se re-proponen).
 *
 * Aforo (decisión H): se AVISA si una sala supera su capacidad con las
 * propuestas automáticas, pero NO se bloquea.
 *
 * Función pura: no toca BD. La query alimenta los datos y la action persiste.
 */

export interface NinoActivoRollover {
  nino_id: string
  nombre: string
  apellidos: string | null
  /** ISO `YYYY-MM-DD` o null (esqueleto sin identidad completada). */
  fecha_nacimiento: string | null
  /** Aula (física) de la matrícula activa en el curso origen; null si no consta. */
  aula_origen_id: string | null
  /** Nombre del aula de origen (para mostrar en la tabla). */
  aula_origen_nombre: string | null
}

export interface AulaDestinoRollover {
  aula_id: string
  nombre: string
  tramo_edad: number[]
  capacidad: number
}

export interface ItemPropuesta {
  nino_id: string
  nombre: string
  apellidos: string | null
  aula_destino_id: string
}

export interface ItemRevisar {
  nino_id: string
  nombre: string
  apellidos: string | null
  /** Salas candidatas (sin fecha → todas las del destino). */
  candidatas: string[]
  motivo: 'sin_fecha_nacimiento'
}

export interface ItemGraduado {
  nino_id: string
  nombre: string
  apellidos: string | null
  anio_nacimiento: number
}

export interface AvisoAforo {
  aula_id: string
  nombre: string
  capacidad: number
  propuestos: number
}

export interface ResultadoPropuesta {
  propuestas: ItemPropuesta[]
  requiereEleccion: ItemRevisar[]
  graduados: ItemGraduado[]
  avisosAforo: AvisoAforo[]
}

/** Año de nacimiento a partir de un ISO `YYYY-MM-DD`; null si no hay fecha. */
function anioDe(fechaIso: string | null): number | null {
  if (!fechaIso) return null
  const anio = Number(fechaIso.slice(0, 4))
  return Number.isFinite(anio) ? anio : null
}

export function computarPropuesta(
  ninos: NinoActivoRollover[],
  aulasDestino: AulaDestinoRollover[],
  ninosYaConDestino: ReadonlySet<string>
): ResultadoPropuesta {
  const propuestas: ItemPropuesta[] = []
  const requiereEleccion: ItemRevisar[] = []
  const graduados: ItemGraduado[] = []
  // Niños con ≥2 candidatas: se resuelven por agrupación tras el bucle (H-2-1).
  const multiples: Array<{
    base: { nino_id: string; nombre: string; apellidos: string | null }
    aula_origen_id: string | null
    candidatas: string[]
  }> = []

  for (const n of ninos) {
    if (ninosYaConDestino.has(n.nino_id)) continue // idempotencia

    const base = { nino_id: n.nino_id, nombre: n.nombre, apellidos: n.apellidos }
    const anio = anioDe(n.fecha_nacimiento)

    if (anio === null) {
      requiereEleccion.push({
        ...base,
        candidatas: aulasDestino.map((a) => a.aula_id),
        motivo: 'sin_fecha_nacimiento',
      })
      continue
    }

    const candidatas = aulasDestino.filter((a) => a.tramo_edad.includes(anio))
    if (candidatas.length === 1) {
      propuestas.push({ ...base, aula_destino_id: candidatas[0]!.aula_id })
    } else if (candidatas.length === 0) {
      graduados.push({ ...base, anio_nacimiento: anio })
    } else {
      multiples.push({
        base,
        aula_origen_id: n.aula_origen_id,
        // Orden estable para que la asignación round-robin sea determinista.
        candidatas: candidatas.map((a) => a.aula_id).sort(),
      })
    }
  }

  // Agrupación por aula de origen (H-2-1): mantener juntos a los del mismo grupo.
  // Cada aula de origen distinta cae en una candidata distinta (round-robin sobre
  // las candidatas ordenadas); los del mismo origen comparten índice → misma sala.
  if (multiples.length > 0) {
    const origenOrden = [...new Set(multiples.map((m) => m.aula_origen_id ?? ''))].sort()
    for (const m of multiples) {
      const idx = origenOrden.indexOf(m.aula_origen_id ?? '')
      const aulaElegida = m.candidatas[idx % m.candidatas.length]!
      propuestas.push({ ...m.base, aula_destino_id: aulaElegida })
    }
  }

  // Aviso de aforo: cuenta las propuestas AUTOMÁTICAS (directas + agrupadas) por
  // sala destino. No recuenta pendientes preexistentes (las trae la query como
  // ocupación base si se quisiera); H-2-0/1 avisa sobre la tanda automática.
  const propuestosPorAula = new Map<string, number>()
  for (const p of propuestas) {
    propuestosPorAula.set(p.aula_destino_id, (propuestosPorAula.get(p.aula_destino_id) ?? 0) + 1)
  }
  const avisosAforo: AvisoAforo[] = []
  for (const a of aulasDestino) {
    const propuestos = propuestosPorAula.get(a.aula_id) ?? 0
    if (propuestos > a.capacidad) {
      avisosAforo.push({
        aula_id: a.aula_id,
        nombre: a.nombre,
        capacidad: a.capacidad,
        propuestos,
      })
    }
  }

  return { propuestas, requiereEleccion, graduados, avisosAforo }
}

/** Una fila de la tabla de revisión (decisión H-2-1: 1 fila por niño activo). */
export interface FilaRollover {
  nino_id: string
  nombre: string
  apellidos: string | null
  aula_actual_id: string | null
  aula_actual_nombre: string | null
  /** Sala propuesta pre-rellena (persistida si existe, si no la calculada). null = se gradúa / sin resolver. */
  aula_propuesta_id: string | null
  accion: 'continua' | 'gradua'
}

/**
 * Construye las filas de la tabla de revisión: UNA por niño activo del curso
 * origen, con su sala actual y la sala propuesta pre-rellena. La propuesta
 * persistida (matrícula `pendiente` ya guardada) tiene prioridad sobre la
 * calculada → reanudable e idempotente. Pura y testeable.
 */
export function construirFilasRollover(
  ninos: NinoActivoRollover[],
  resultado: ResultadoPropuesta,
  pendientes: ReadonlyMap<string, string>
): FilaRollover[] {
  const propuestaPorNino = new Map(resultado.propuestas.map((p) => [p.nino_id, p.aula_destino_id]))
  const graduadosSet = new Set(resultado.graduados.map((g) => g.nino_id))

  return ninos.map((n) => {
    const aulaPropuesta = pendientes.get(n.nino_id) ?? propuestaPorNino.get(n.nino_id) ?? null
    const accion: 'continua' | 'gradua' =
      aulaPropuesta !== null ? 'continua' : graduadosSet.has(n.nino_id) ? 'gradua' : 'continua'
    return {
      nino_id: n.nino_id,
      nombre: n.nombre,
      apellidos: n.apellidos,
      aula_actual_id: n.aula_origen_id,
      aula_actual_nombre: n.aula_origen_nombre,
      aula_propuesta_id: aulaPropuesta,
      accion,
    }
  })
}
