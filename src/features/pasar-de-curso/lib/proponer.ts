/**
 * F11-H-2 "pasar de curso" — lógica PURA de propuesta de matrículas por edad.
 *
 * Modelo B1 (decisión usuario 2026-06-24): las salas mantienen su `tramo_edad`
 * fijo y **el niño sube de sala**. Al pasar de curso, cada niño con matrícula
 * activa en el curso saliente se propone para la sala del curso entrante cuyo
 * `tramo_edad` incluya su **año de nacimiento**.
 *
 * Casos (decisión C):
 *  - 1 sala candidata  → propuesta directa.
 *  - 0 salas (se sale de la franja 0-3) → **graduado** (no se propone).
 *  - ≥2 salas candidatas → **requiere elección** de la directora.
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
  /** Salas candidatas (≥2 → elegir; 0 con fecha → graduado; sin fecha → todas). */
  candidatas: string[]
  motivo: 'multiples_candidatas' | 'sin_fecha_nacimiento'
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
      requiereEleccion.push({
        ...base,
        candidatas: candidatas.map((a) => a.aula_id),
        motivo: 'multiples_candidatas',
      })
    }
  }

  // Aviso de aforo: cuenta las propuestas AUTOMÁTICAS por sala destino + las ya
  // existentes en destino no se recuentan aquí (las trae la query como ocupación
  // base si se quisiera; H-2-0 avisa sobre la tanda automática).
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
