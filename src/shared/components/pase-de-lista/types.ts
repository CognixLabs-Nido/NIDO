import type { ReactNode } from 'react'
import type { z } from 'zod'

/**
 * Patrón "Pase de Lista" — tipos compartidos por el componente y el hook.
 *
 * Diseñado para ser genérico (ADR-0014): Fase 4 lo usa para asistencia,
 * Fase 4.5 lo reusará para comida, Fase 7 para confirmación de eventos.
 *
 * - `TItem`  = entidad de la fila (ej. niño matriculado).
 * - `TValue` = objeto con los valores de las columnas para esa fila
 *              (ej. { estado, hora_llegada, observaciones }).
 */

export interface PaseDeListaColumn<TValue> {
  /** Identificador único de la columna; coincide con la clave en TValue. */
  id: keyof TValue & string
  /** Etiqueta i18n ya traducida. */
  label: string
  /** Tipo de input. */
  type: 'radio' | 'time' | 'text-short' | 'select' | 'enum-badges'
  /** Opciones cuando type es radio / select / enum-badges. value se guarda en TValue[id]. */
  options?: ReadonlyArray<{ value: string; label: string }>
  /** Validación Zod por celda (opcional). Si está, se valida en blur y en submit. */
  zod?: z.ZodTypeAny
  /** Visibilidad condicional según el valor actual de la fila. */
  visibleWhen?: (row: Partial<TValue>) => boolean
  /** Clase Tailwind opcional para anchura (ej. "w-32"). */
  width?: string
  /** Placeholder opcional para inputs tipo time/text-short. */
  placeholder?: string
}

export interface PaseDeListaQuickAction<TValue> {
  id: string
  label: string
  /** Patch a aplicar a cada fila visible. Recibe el valor actual para
   *  poder hacer merges (ej. mantener `hora_llegada` si ya estaba). */
  apply: (currentRow: Partial<TValue>) => Partial<TValue>
  /** Si true, no toca filas que ya estén dirty. */
  onlyClean?: boolean
}

export interface PaseDeListaItem<TItem, TValue> {
  /** Identificador único de la fila (ej. nino.id). */
  id: string
  /** Entidad asociada a la fila (para renderizar columna principal). */
  item: TItem
  /** Valor pre-cargado de los inputs. null si no existe registro previo. */
  initial: TValue | null
  /** Badges informativos a renderizar junto a la entidad (ej. "Reportada por familia"). */
  badges?: ReadonlyArray<{
    label: string
    variant?: 'warm' | 'info' | 'destructive' | 'secondary'
  }>
}

export interface PaseDeListaI18n {
  pending: string
  dirty: string
  saved: string
  errorRow: string
}

export interface PaseDeListaTableProps<TItem, TValue> {
  /** Filas a renderizar. */
  items: ReadonlyArray<PaseDeListaItem<TItem, TValue>>
  /** Renderer de la primera columna (avatar + nombre). */
  renderItem: (item: TItem) => ReactNode
  /** Columnas con inputs. */
  columns: ReadonlyArray<PaseDeListaColumn<TValue>>
  /** Quick actions arriba de la tabla. */
  quickActions?: ReadonlyArray<PaseDeListaQuickAction<TValue>>
  /** Submit batch: recibe solo filas dirty. */
  onBatchSubmit: (rows: Array<{ id: string; item: TItem; value: TValue }>) => Promise<{
    success: boolean
    error?: string
  }>
  /** Solo lectura: inputs disabled, sin quick actions ni botón submit. */
  readOnly?: boolean
  /** Texto i18n del botón submit. */
  submitLabel: string
  /** Etiquetas i18n para estados de fila. */
  i18n: PaseDeListaI18n
  /** Sufijo opcional renderizado tras la última columna por fila (acciones extra). */
  renderRowExtra?: (item: TItem, value: Partial<TValue>) => ReactNode
}

export type RowStatus = 'pending' | 'dirty' | 'saving' | 'saved' | 'error'

export interface RowState<TValue> {
  value: Partial<TValue>
  initial: TValue | null
  status: RowStatus
  errors: Partial<Record<keyof TValue, string>>
}
