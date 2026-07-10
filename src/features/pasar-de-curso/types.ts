import type {
  AulaDestinoRollover,
  FilaRollover,
  NinoActivoRollover,
  ResultadoPropuesta,
} from './lib/proponer'

export interface PendienteDestino {
  nino_id: string
  aula_id: string
}

/** Estado completo que alimenta la UI del rollover (datos persistidos + insumos). */
export interface EstadoRollover {
  cursoDestino: { id: string; nombre: string; estado: 'planificado' | 'activo' | 'cerrado' }
  cursoOrigen: { id: string; nombre: string } | null
  aulasDestino: AulaDestinoRollover[]
  ninosActivos: NinoActivoRollover[]
  /** Matrículas `pendiente` ya creadas en el curso destino (propuesta persistida). */
  pendientes: PendienteDestino[]
  /** F-3-A: nino_id con fila `rollover_finaliza` en el curso destino (destino "Finaliza"). */
  finalizados: string[]
}

export type { FilaRollover, ResultadoPropuesta }
