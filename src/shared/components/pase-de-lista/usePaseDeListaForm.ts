'use client'

import { useCallback, useMemo, useState } from 'react'

import type { PaseDeListaColumn, PaseDeListaItem, PaseDeListaQuickAction, RowState } from './types'

/**
 * Hook que gestiona el state local de un pase de lista: valores por celda,
 * dirty tracking, errores de validación Zod por columna, y batch submit.
 *
 * Está desacoplado del UI para que sea testable por su cuenta y reusable
 * en posibles vistas con presentación distinta (cards en mobile, tabla
 * en desktop). El componente <PaseDeListaTable /> lo consume.
 */

export interface UsePaseDeListaFormOptions<TItem, TValue> {
  items: ReadonlyArray<PaseDeListaItem<TItem, TValue>>
  columns: ReadonlyArray<PaseDeListaColumn<TValue>>
}

export interface UsePaseDeListaFormResult<TItem, TValue> {
  rows: Map<string, RowState<TValue>>
  setValue: (rowId: string, columnId: keyof TValue & string, value: unknown) => void
  applyQuickAction: (action: PaseDeListaQuickAction<TValue>) => void
  validate: () =>
    | { ok: true }
    | { ok: false; firstError: { rowId: string; columnId: string; message: string } }
  collectDirty: () => Array<{ id: string; item: TItem; value: TValue }>
  markStatus: (rowIds: ReadonlyArray<string>, status: RowState<TValue>['status']) => void
  setRowError: (rowId: string, columnId: keyof TValue & string, message: string) => void
  reset: () => void
}

function initialStateFor<TValue>(initial: TValue | null): RowState<TValue> {
  return {
    value: initial ? { ...initial } : {},
    initial,
    status: initial ? 'saved' : 'pending',
    errors: {},
  }
}

export function usePaseDeListaForm<TItem, TValue extends Record<string, unknown>>(
  opts: UsePaseDeListaFormOptions<TItem, TValue>
): UsePaseDeListaFormResult<TItem, TValue> {
  const { items, columns } = opts

  // Map por rowId para mutaciones O(1). Se reinicializa cuando cambia la
  // identidad de la lista de items (el padre debe pasar `key` para forzar
  // remount si la lista cambia drásticamente).
  const [rows, setRows] = useState<Map<string, RowState<TValue>>>(() => {
    const m = new Map<string, RowState<TValue>>()
    for (const it of items) m.set(it.id, initialStateFor(it.initial))
    return m
  })

  // Lookup item por id para `collectDirty`.
  const itemById = useMemo(() => {
    const m = new Map<string, TItem>()
    for (const it of items) m.set(it.id, it.item)
    return m
  }, [items])

  const setValue = useCallback((rowId: string, columnId: keyof TValue & string, value: unknown) => {
    setRows((prev) => {
      const current = prev.get(rowId)
      if (!current) return prev
      const next = new Map(prev)
      const nextValue = { ...current.value, [columnId]: value }
      next.set(rowId, {
        ...current,
        value: nextValue,
        status: 'dirty',
        errors: { ...current.errors, [columnId]: undefined } as RowState<TValue>['errors'],
      })
      return next
    })
  }, [])

  const applyQuickAction = useCallback((action: PaseDeListaQuickAction<TValue>) => {
    setRows((prev) => {
      const next = new Map(prev)
      for (const [rowId, row] of prev.entries()) {
        if (action.onlyClean && row.status !== 'pending' && row.status !== 'saved') continue
        const patch = action.apply(row.value)
        const nextValue = { ...row.value, ...patch }
        next.set(rowId, {
          ...row,
          value: nextValue,
          status: 'dirty',
          errors: {},
        })
      }
      return next
    })
  }, [])

  const validate = useCallback((): ReturnType<
    UsePaseDeListaFormResult<TItem, TValue>['validate']
  > => {
    // Solo validamos filas dirty: las filas pending (sin tocar) o saved no
    // afectan al submit. Esto coincide con la semántica de `collectDirty`.
    for (const [rowId, row] of rows.entries()) {
      if (row.status !== 'dirty') continue
      for (const col of columns) {
        if (col.visibleWhen && !col.visibleWhen(row.value)) continue
        if (!col.zod) continue
        const r = col.zod.safeParse(row.value[col.id])
        if (!r.success) {
          return {
            ok: false,
            firstError: {
              rowId,
              columnId: col.id,
              message: r.error.issues[0]?.message ?? 'invalid',
            },
          }
        }
      }
    }
    return { ok: true }
  }, [rows, columns])

  const collectDirty = useCallback(() => {
    const out: Array<{ id: string; item: TItem; value: TValue }> = []
    for (const [rowId, row] of rows.entries()) {
      if (row.status !== 'dirty') continue
      const item = itemById.get(rowId)
      if (!item) continue
      out.push({ id: rowId, item, value: row.value as TValue })
    }
    return out
  }, [rows, itemById])

  const markStatus = useCallback(
    (rowIds: ReadonlyArray<string>, status: RowState<TValue>['status']) => {
      setRows((prev) => {
        const next = new Map(prev)
        for (const id of rowIds) {
          const r = prev.get(id)
          if (r) next.set(id, { ...r, status })
        }
        return next
      })
    },
    []
  )

  const setRowError = useCallback(
    (rowId: string, columnId: keyof TValue & string, message: string) => {
      setRows((prev) => {
        const r = prev.get(rowId)
        if (!r) return prev
        const next = new Map(prev)
        next.set(rowId, {
          ...r,
          status: 'error',
          errors: { ...r.errors, [columnId]: message } as RowState<TValue>['errors'],
        })
        return next
      })
    },
    []
  )

  const reset = useCallback(() => {
    setRows(() => {
      const m = new Map<string, RowState<TValue>>()
      for (const it of items) m.set(it.id, initialStateFor(it.initial))
      return m
    })
  }, [items])

  return {
    rows,
    setValue,
    applyQuickAction,
    validate,
    collectDirty,
    markStatus,
    setRowError,
    reset,
  }
}
