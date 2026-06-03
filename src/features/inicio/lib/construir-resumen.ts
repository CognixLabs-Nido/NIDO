import type { CitaAgenda } from '@/features/agenda/types'
import type { DiaCerradoProximo } from '@/features/calendario-centro/types'
import type { EventoCalendario } from '@/features/eventos/types'

import type { ResumenItem, ResumenSemana } from '../types'
import type { VentanaSemana } from './ventana-semana'

/** 'HH:MM:SS' → 'HH:MM'. null se preserva (todo-el-día). */
function hhmm(hora: string | null): string | null {
  return hora ? hora.slice(0, 5) : null
}

/** Orden: por fecha asc; dentro del día, todo-el-día (sin hora) primero, luego por hora asc. */
function comparar(a: ResumenItem, b: ResumenItem): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1
  if (a.hora === b.hora) return 0
  if (a.hora === null) return -1
  if (b.hora === null) return 1
  return a.hora < b.hora ? -1 : 1
}

/**
 * Une las 3 fuentes (citas, eventos, cierres) en una lista ordenada, acotada a la
 * semana ISO en curso, y la parte en `hoy` / `semana` (resto de la semana).
 * Función pura: el ámbito por rol ya lo aplicó la RLS en las queries; aquí solo se
 * normaliza, recorta y ordena.
 *
 * - Excluye citas/eventos cancelados.
 * - Eventos multi-día que solapan la semana se anclan a su inicio recortado al
 *   lunes (se muestran una vez, como "en curso").
 */
export function construirResumen(
  ventana: VentanaSemana,
  citas: CitaAgenda[],
  eventos: EventoCalendario[],
  cierres: DiaCerradoProximo[]
): ResumenSemana {
  const { hoy, desde, hasta } = ventana
  const items: ResumenItem[] = []

  for (const c of citas) {
    if (c.estado === 'cancelada') continue
    if (c.fecha < desde || c.fecha > hasta) continue
    items.push({
      kind: 'cita',
      id: c.id,
      fecha: c.fecha,
      hora: hhmm(c.hora_inicio),
      titulo: c.titulo,
      tipo: c.tipo,
    })
  }

  for (const e of eventos) {
    if (e.estado === 'cancelado') continue
    const fin = e.fecha_fin ?? e.fecha
    // Solapa la semana si empieza en/antes del domingo y acaba en/después del lunes.
    if (e.fecha > hasta || fin < desde) continue
    // Multi-día que arranca antes del lunes → se ancla al lunes (en curso).
    const fecha = e.fecha < desde ? desde : e.fecha
    items.push({
      kind: 'evento',
      id: e.id,
      fecha,
      hora: hhmm(e.hora_inicio),
      titulo: e.titulo,
      tipo: e.tipo,
    })
  }

  for (const d of cierres) {
    if (d.fecha < desde || d.fecha > hasta) continue
    items.push({
      kind: 'cierre',
      id: d.fecha,
      fecha: d.fecha,
      hora: null,
      titulo: d.observaciones,
      tipo: d.tipo,
    })
  }

  items.sort(comparar)

  return {
    hoy: items.filter((i) => i.fecha === hoy),
    semana: items.filter((i) => i.fecha !== hoy),
    desde,
    hasta,
  }
}
