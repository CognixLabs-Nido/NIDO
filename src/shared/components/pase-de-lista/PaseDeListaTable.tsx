'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { PaseDeListaColumn, PaseDeListaTableProps, RowStatus } from './types'
import { usePaseDeListaForm } from './usePaseDeListaForm'

/**
 * Tabla "Pase de Lista" genérica reutilizable (ADR-0014).
 *
 * Renderiza una tabla con `items` como filas y `columns` como columnas.
 * Cada fila tiene su propio state local (dirty, errores, saved). Las
 * quick actions aplican patches a múltiples filas a la vez. Al submitir,
 * solo se envían las filas tocadas vía `onBatchSubmit`.
 *
 * No se acopla a Realtime: el padre puede pasar un `key` distinto para
 * forzar re-mount si llega un cambio externo importante (mismo patrón
 * que `useAgendaRealtime` de Fase 3).
 *
 * Pensado para reuso en F4.5 (comida) y F7 (confirmaciones).
 */
export function PaseDeListaTable<TItem, TValue extends Record<string, unknown>>(
  props: PaseDeListaTableProps<TItem, TValue>
) {
  const {
    items,
    renderItem,
    columns,
    quickActions = [],
    onBatchSubmit,
    readOnly = false,
    submitLabel,
    i18n,
    renderRowExtra,
  } = props

  const form = usePaseDeListaForm<TItem, TValue>({ items, columns })
  const [submitting, setSubmitting] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  async function onSubmit() {
    setGlobalError(null)
    const v = form.validate()
    if (!v.ok) {
      form.setRowError(v.firstError.rowId, v.firstError.columnId as never, v.firstError.message)
      return
    }
    const dirty = form.collectDirty()
    if (dirty.length === 0) return

    const dirtyIds = dirty.map((d) => d.id)
    form.markStatus(dirtyIds, 'saving')
    setSubmitting(true)
    try {
      const result = await onBatchSubmit(dirty)
      if (result.success) {
        form.markStatus(dirtyIds, 'saved')
      } else {
        form.markStatus(dirtyIds, 'error')
        setGlobalError(result.error ?? 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const hasDirty = Array.from(form.rows.values()).some((r) => r.status === 'dirty')

  return (
    <div className="space-y-4">
      {!readOnly && quickActions.length > 0 && (
        <div
          className="border-border bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border p-3"
          aria-label="Quick actions"
        >
          {quickActions.map((qa) => (
            <Button
              key={qa.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => form.applyQuickAction(qa)}
              data-testid={`pase-quick-${qa.id}`}
            >
              {qa.label}
            </Button>
          ))}
        </div>
      )}

      <div
        className="border-border bg-card overflow-hidden rounded-2xl border shadow-md"
        role="table"
        aria-label="Pase de lista"
      >
        <div
          className="bg-muted/50 hidden border-b text-xs font-semibold tracking-wide uppercase sm:grid sm:gap-2 sm:px-4 sm:py-2"
          style={gridTemplate(columns, !!renderRowExtra)}
        >
          <div role="columnheader">·</div>
          {columns.map((c) => (
            <div key={c.id} role="columnheader">
              {c.label}
            </div>
          ))}
          {renderRowExtra && <div role="columnheader" aria-label="acciones" />}
          <div role="columnheader" aria-label="estado" className="text-right">
            ·
          </div>
        </div>

        <ul className="divide-y" aria-live="polite">
          {items.map((it) => {
            const row = form.rows.get(it.id)
            if (!row) return null
            return (
              <li
                key={it.id}
                role="row"
                aria-label={`Fila ${it.id}`}
                className={cn('grid gap-2 px-4 py-3 transition-colors', rowBgFor(row.status))}
                style={gridTemplate(columns, !!renderRowExtra)}
              >
                <div role="cell" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {renderItem(it.item)}
                  {it.badges?.map((b, i) => (
                    <Badge
                      key={i}
                      variant={b.variant ?? 'secondary'}
                      data-testid={`pase-badge-${it.id}-${i}`}
                    >
                      {b.label}
                    </Badge>
                  ))}
                </div>

                {columns.map((c) => {
                  const visible = c.visibleWhen ? c.visibleWhen(row.value) : true
                  if (!visible) return <div role="cell" key={c.id} />
                  return (
                    <div role="cell" key={c.id} className={c.width}>
                      <ColumnInput
                        column={c}
                        rowId={it.id}
                        value={row.value[c.id]}
                        error={row.errors[c.id]}
                        readOnly={readOnly}
                        onChange={(v) => form.setValue(it.id, c.id, v)}
                      />
                    </div>
                  )
                })}

                {renderRowExtra && (
                  <div role="cell" className="flex items-center justify-end">
                    {renderRowExtra(it.item, row.value)}
                  </div>
                )}

                <div
                  role="cell"
                  className="flex items-center justify-end"
                  data-testid={`pase-status-${it.id}`}
                  data-status={row.status}
                >
                  <StatusBadge status={row.status} labels={i18n} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {globalError && (
        <p className="text-destructive text-sm" role="alert">
          {globalError}
        </p>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !hasDirty}
            data-testid="pase-submit"
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

function gridTemplate<TValue>(
  columns: ReadonlyArray<PaseDeListaColumn<TValue>>,
  hasExtra: boolean
): React.CSSProperties {
  // [item] [...columns] ([extra]) [status]
  const cols = ['minmax(0, 1fr)', ...columns.map((c) => c.width ?? '160px')]
  if (hasExtra) cols.push('auto')
  cols.push('80px')
  return { gridTemplateColumns: cols.join(' ') }
}

function rowBgFor(status: RowStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-card'
    case 'dirty':
      return 'bg-info-100/60'
    case 'saving':
      return 'bg-info-100/40'
    case 'saved':
      return 'bg-success-100/60'
    case 'error':
      return 'bg-coral-100/60'
  }
}

function StatusBadge({
  status,
  labels,
}: {
  status: RowStatus
  labels: PaseDeListaTableProps<unknown, never>['i18n']
}) {
  if (status === 'pending') return <Badge variant="outline">{labels.pending}</Badge>
  if (status === 'dirty') return <Badge variant="info">{labels.dirty}</Badge>
  if (status === 'saving') return <Badge variant="info">…</Badge>
  if (status === 'saved') return <Badge variant="success">{labels.saved}</Badge>
  if (status === 'error') return <Badge variant="destructive">{labels.errorRow}</Badge>
  return null
}

interface ColumnInputProps<TValue> {
  column: PaseDeListaColumn<TValue>
  rowId: string
  value: unknown
  error: string | undefined
  readOnly: boolean
  onChange: (value: unknown) => void
}

function ColumnInput<TValue>({
  column,
  rowId,
  value,
  error,
  readOnly,
  onChange,
}: ColumnInputProps<TValue>) {
  const ariaInvalid = error ? true : undefined
  if (column.type === 'time') {
    return (
      <>
        <Input
          type="time"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          disabled={readOnly}
          aria-invalid={ariaInvalid}
          aria-label={column.label}
          data-testid={`pase-cell-${rowId}-${column.id}`}
        />
        {error && (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  if (column.type === 'text-short') {
    return (
      <>
        <Input
          type="text"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          disabled={readOnly}
          maxLength={500}
          aria-invalid={ariaInvalid}
          aria-label={column.label}
          placeholder={column.placeholder}
          data-testid={`pase-cell-${rowId}-${column.id}`}
        />
        {error && (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  if ((column.type === 'radio' || column.type === 'select') && column.options) {
    if (column.type === 'select') {
      return (
        <>
          <Select
            items={[...column.options]}
            value={(value as string | undefined) ?? undefined}
            onValueChange={(v) => onChange(v)}
            disabled={readOnly}
          >
            <SelectTrigger data-testid={`pase-cell-${rowId}-${column.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {column.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p className="text-destructive mt-1 text-xs" role="alert">
              {error}
            </p>
          )}
        </>
      )
    }
    // radio (botones inline tipo segmented)
    return (
      <>
        <div
          role="radiogroup"
          aria-label={column.label}
          className="flex flex-wrap gap-1"
          data-testid={`pase-cell-${rowId}-${column.id}`}
        >
          {column.options.map((o) => {
            const selected = value === o.value
            return (
              <Button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                variant={selected ? 'default' : 'outline'}
                size="xs"
                onClick={() => onChange(o.value)}
                disabled={readOnly}
                data-testid={`pase-cell-${rowId}-${column.id}-${o.value}`}
              >
                {o.label}
              </Button>
            )
          })}
        </div>
        {error && (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  if (column.type === 'enum-badges' && column.options) {
    return (
      <div className="flex flex-wrap gap-1" data-testid={`pase-cell-${rowId}-${column.id}`}>
        {column.options.map((o) => {
          const selected = value === o.value
          return (
            <Badge
              key={o.value}
              variant={selected ? 'warm' : 'outline'}
              role="button"
              tabIndex={readOnly ? -1 : 0}
              onClick={() => !readOnly && onChange(o.value)}
              onKeyDown={(e) => {
                if (readOnly) return
                if (e.key === 'Enter' || e.key === ' ') onChange(o.value)
              }}
              className={cn(!readOnly && 'cursor-pointer')}
            >
              {o.label}
            </Badge>
          )
        })}
      </div>
    )
  }

  return null
}
