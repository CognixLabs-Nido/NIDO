/** Tipo de ítem del resumen de Inicio: agrega 3 fuentes heterogéneas. */
export type ResumenKind = 'evento' | 'cita' | 'cierre'

/**
 * Ítem normalizado del resumen de la semana. Une eventos (Calendario Escolar),
 * citas (Agenda) y cierres del centro (`dias_centro`) en una forma común,
 * ordenable por fecha/hora. El enlace al detalle lo resuelve la UI a partir de
 * `kind` (eventos/cierres → `/calendario`; citas → `/agenda`).
 */
export interface ResumenItem {
  kind: ResumenKind
  /** uuid del evento/cita, o la fecha del cierre (clave estable para React). */
  id: string
  /** YYYY-MM-DD en el que se muestra (cierres/eventos multi-día se anclan dentro de la semana). */
  fecha: string
  /** HH:MM o null para todo-el-día (cierres y eventos sin hora) → ordenan primero. */
  hora: string | null
  /** Título; null en cierres sin observaciones (la UI cae al label del tipo). */
  titulo: string | null
  /** Subtipo de la fuente (`tipo_evento` | `tipo_cita` | `tipo_dia_centro`) para icono/label. */
  tipo: string
}

/** Resumen del día + la semana en curso, particionado para las dos secciones (AG-15). */
export interface ResumenSemana {
  /** Ítems de hoy (Europe/Madrid). */
  hoy: ResumenItem[]
  /** Ítems del resto de la semana ISO en curso (lun–dom), excluido hoy. */
  semana: ResumenItem[]
  /** Lunes de la semana en curso (YYYY-MM-DD). */
  desde: string
  /** Domingo de la semana en curso (YYYY-MM-DD). */
  hasta: string
}
