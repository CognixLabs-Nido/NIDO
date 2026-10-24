// PR-12 — el listado único del pase de servicios: todos los niños del centro con los tres
// servicios en la misma fila. Puro y sin dependencias (testeable).
//
// Lazy, como la asistencia (ADR-0015): una casilla sin fila es `null`, nadie la ha apuntado.
// En pantalla, `null` y `false` se ven igual (sin marcar), así que desmarcar algo que nunca se
// apuntó no es un cambio: solo se guarda lo que cambia lo que se cobra.

import type { PaseServiciosItem, ServicioDiario } from '../schemas/parte-servicio'

/** El orden del día: mañana, comedor, tarde. */
export const SERVICIOS_DEL_DIA: readonly ServicioDiario[] = ['matinera', 'comedor', 'vespertina']

export interface AlumnoListado {
  nino_id: string
  nombre: string
  apellidos: string
  aula_id: string
  aula_nombre: string
}

export interface ParteDia {
  nino_id: string
  servicio: ServicioDiario
  presente: boolean
}

export interface FilaPase {
  ninoId: string
  nombre: string
  apellidos: string
  aulaId: string
  aulaNombre: string
  servicios: Record<ServicioDiario, boolean | null>
}

/** Clave de una casilla. */
export function casilla(ninoId: string, servicio: ServicioDiario): string {
  return `${ninoId}:${servicio}`
}

/** El listado con lo ya apuntado ese día; conserva el orden del listado (clase, apellidos). */
export function combinarPase(listado: AlumnoListado[], partes: ParteDia[]): FilaPase[] {
  const apuntado = new Map(partes.map((p) => [casilla(p.nino_id, p.servicio), p.presente]))
  return listado.map((a) => ({
    ninoId: a.nino_id,
    nombre: a.nombre,
    apellidos: a.apellidos,
    aulaId: a.aula_id,
    aulaNombre: a.aula_nombre,
    servicios: {
      matinera: apuntado.get(casilla(a.nino_id, 'matinera')) ?? null,
      comedor: apuntado.get(casilla(a.nino_id, 'comedor')) ?? null,
      vespertina: apuntado.get(casilla(a.nino_id, 'vespertina')) ?? null,
    },
  }))
}

/**
 * Lo que hay que guardar: cada casilla marcada en pantalla cuyo valor difiere del guardado.
 * `marcas` son las casillas tocadas (clave → marcada); las no tocadas no cambian.
 */
export function cambiosPase(
  filas: FilaPase[],
  marcas: Record<string, boolean>
): PaseServiciosItem[] {
  const out: PaseServiciosItem[] = []
  for (const f of filas) {
    for (const s of SERVICIOS_DEL_DIA) {
      const marcada = marcas[casilla(f.ninoId, s)]
      if (marcada === undefined) continue
      if (marcada !== f.servicios[s]) {
        out.push({ nino_id: f.ninoId, servicio: s, presente: marcada })
      }
    }
  }
  return out
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Filtra por clase (null = todas) y por nombre o apellidos, sin distinguir tildes. */
export function filtrarFilas(filas: FilaPase[], aulaId: string | null, texto: string): FilaPase[] {
  const q = normalizar(texto)
  return filas.filter(
    (f) =>
      (aulaId === null || f.aulaId === aulaId) &&
      (q === '' || normalizar(`${f.nombre} ${f.apellidos}`).includes(q))
  )
}

/** Las clases del listado, en su orden y sin repetir. */
export function clasesDe(filas: FilaPase[]): Array<{ id: string; nombre: string }> {
  const vistas = new Map<string, string>()
  for (const f of filas) if (!vistas.has(f.aulaId)) vistas.set(f.aulaId, f.aulaNombre)
  return [...vistas].map(([id, nombre]) => ({ id, nombre }))
}
