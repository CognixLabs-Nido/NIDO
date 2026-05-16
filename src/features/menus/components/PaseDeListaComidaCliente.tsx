'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { ModalidadDayPicker } from '@/shared/components/day-picker/ModalidadDayPicker'
import { modoDeFecha } from '@/shared/components/day-picker/modo-fecha'
import { PaseDeListaTable } from '@/shared/components/pase-de-lista/PaseDeListaTable'
import type {
  PaseDeListaColumn,
  PaseDeListaItem,
  PaseDeListaQuickAction,
} from '@/shared/components/pase-de-lista/types'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import type { CantidadComida, MomentoComida } from '@/features/agenda-diaria/schemas/agenda-diaria'

import { batchRegistrarComidas } from '../actions/batch-registrar-comidas'
import type { PaseDeListaComidaPayload } from '../types'

interface Props {
  aulaId: string
  locale: string
  payload: PaseDeListaComidaPayload
}

const MOMENTOS: ReadonlyArray<MomentoComida> = ['desayuno', 'media_manana', 'comida', 'merienda']

const CANTIDADES: ReadonlyArray<CantidadComida> = ['todo', 'mayoria', 'mitad', 'poco', 'nada']

// Tipo de valor para la fila — intersección con `Record<string, unknown>`
// para casar con el constraint de <PaseDeListaTable />.
type ValorComida = {
  descripcion: string | null
  cantidad: CantidadComida | ''
  observaciones: string | null
} & Record<string, unknown>

export function PaseDeListaComidaCliente({ aulaId: _aulaId, locale, payload }: Props) {
  const t = useTranslations('comida_batch')
  const tMenus = useTranslations('menus')
  const tCantidad = useTranslations('agenda.cantidad_comida_opciones')
  const router = useRouter()
  const hoy = hoyMadrid()
  const { fecha, momento, filas, menu } = payload
  const modo = modoDeFecha(fecha)
  const editable = modo === 'hoy'
  const descripcionMenuDelDia = menu ? (menu[momento] ?? null) : null

  // Quick action: dropdown para elegir cantidad antes de aplicar a todos.
  const [cantidadQuick, setCantidadQuick] = useState<CantidadComida>('todo')

  function cantidadLabel(c: CantidadComida): string {
    switch (c) {
      case 'todo':
        return tCantidad('todo')
      case 'mayoria':
        return tCantidad('mayoria')
      case 'mitad':
        return tCantidad('mitad')
      case 'poco':
        return tCantidad('poco')
      case 'nada':
        return tCantidad('nada')
    }
  }

  function navegarConParams(updates: Record<string, string>) {
    const url = new URL(window.location.href)
    for (const [k, v] of Object.entries(updates)) url.searchParams.set(k, v)
    router.push(url.pathname + url.search)
  }

  // Si no hay menú publicado vigente, empty state.
  if (!menu) {
    return (
      <div className="space-y-4">
        <ModalidadDayPicker
          fecha={fecha}
          locale={locale}
          hoy={hoy}
          modo={modo}
          onChange={(f) => navegarConParams({ fecha: f })}
        />
        <Card>
          <CardContent className="space-y-2">
            <p className="text-foreground font-semibold">{t('sin_plantilla.title')}</p>
            <p className="text-muted-foreground text-sm">{t('sin_plantilla.description')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const items: PaseDeListaItem<{ id: string; nombre: string; apellidos: string }, ValorComida>[] =
    filas.map((f) => {
      const initial: ValorComida | null = f.comida
        ? {
            descripcion: f.comida.descripcion ?? descripcionMenuDelDia,
            cantidad: f.comida.cantidad,
            observaciones: f.comida.observaciones,
          }
        : null
      const badges: Array<{
        label: string
        variant?: 'warm' | 'info' | 'destructive' | 'secondary'
      }> = []
      if (f.alertas.alergia_grave)
        badges.push({ label: t('alertas.alergia_grave'), variant: 'destructive' })
      if (f.alertas.medicacion) badges.push({ label: t('alertas.medicacion'), variant: 'warm' })

      return {
        id: f.nino.id,
        item: { id: f.nino.id, nombre: f.nino.nombre, apellidos: f.nino.apellidos },
        initial,
        badges,
      }
    })

  const columns: PaseDeListaColumn<ValorComida>[] = [
    {
      id: 'descripcion',
      label: t('columna.descripcion'),
      type: 'text-short',
      width: '280px',
      placeholder: t('placeholder_descripcion'),
    },
    {
      id: 'cantidad',
      label: t('columna.cantidad'),
      type: 'enum-badges',
      width: '320px',
      options: CANTIDADES.map((c) => ({
        value: c,
        label: tMenus(`momento.comida` as never) /* placeholder unused */ ?? c,
      })).map((_, i) => ({
        value: CANTIDADES[i]!,
        label: cantidadLabel(CANTIDADES[i]!),
      })),
    },
    {
      id: 'observaciones',
      label: t('columna.observaciones'),
      type: 'text-short',
      width: '200px',
      placeholder: t('placeholder_observaciones'),
    },
  ]

  // Quick action única que aplica la cantidad seleccionada arriba +
  // pre-rellena la descripción con el menú del día si la fila no la tiene.
  const quickActions: PaseDeListaQuickAction<ValorComida>[] = [
    {
      id: 'aplicar-cantidad',
      label: t('quick_actions.todos_aplicar'),
      apply: (current) => ({
        cantidad: cantidadQuick,
        descripcion: current.descripcion ?? descripcionMenuDelDia,
      }),
      onlyClean: false,
    },
  ]

  async function onBatchSubmit(
    rows: Array<{ id: string; item: unknown; value: ValorComida }>
  ): Promise<{ success: boolean; error?: string }> {
    const result = await batchRegistrarComidas({
      fecha,
      momento,
      items: rows.map((r) => ({
        nino_id: r.id,
        descripcion: (r.value.descripcion ?? descripcionMenuDelDia) || null,
        cantidad: r.value.cantidad as CantidadComida,
        observaciones: r.value.observaciones ?? null,
      })),
    })
    if (result.success) {
      router.refresh()
      return { success: true }
    }
    return { success: false, error: result.error }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ModalidadDayPicker
          fecha={fecha}
          locale={locale}
          hoy={hoy}
          modo={modo}
          onChange={(f) => navegarConParams({ fecha: f })}
        />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('momento_label')}:</span>
          <Select
            value={momento}
            onValueChange={(v) => {
              if (typeof v === 'string') navegarConParams({ momento: v })
            }}
          >
            <SelectTrigger data-testid="comida-momento-selector" className="min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOMENTOS.map((m) => (
                <SelectItem key={m} value={m}>
                  {tMenus(`momento.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-1">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {t('menu_del_dia')}
          </p>
          <p className="text-foreground text-sm font-medium" data-testid="comida-menu-del-dia">
            {descripcionMenuDelDia ?? '—'}
          </p>
        </CardContent>
      </Card>

      {filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('ningun_nino')}</p>
      ) : editable ? (
        <>
          <div className="bg-muted/30 border-border flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">
              {t('quick_actions.todos_aplicar')}
            </span>
            <Select
              value={cantidadQuick}
              onValueChange={(v) => setCantidadQuick(v as CantidadComida)}
            >
              <SelectTrigger data-testid="comida-cantidad-quick-selector" className="min-w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANTIDADES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {cantidadLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PaseDeListaTable
            ariaLabel={t('title')}
            items={items}
            renderItem={(n) => (
              <span className="text-foreground text-sm font-medium">
                {n.nombre} {n.apellidos}
              </span>
            )}
            columns={columns}
            quickActions={quickActions}
            onBatchSubmit={onBatchSubmit}
            readOnly={false}
            submitLabel={t('guardar')}
            i18n={{
              pending: t('status.pending'),
              dirty: t('status.dirty'),
              saved: t('status.saved'),
              errorRow: t('status.error'),
            }}
          />
        </>
      ) : (
        <PaseDeListaTable
          ariaLabel={t('title')}
          items={items}
          renderItem={(n) => (
            <span className="text-foreground text-sm font-medium">
              {n.nombre} {n.apellidos}
            </span>
          )}
          columns={columns}
          onBatchSubmit={onBatchSubmit}
          readOnly={true}
          submitLabel={t('guardar')}
          i18n={{
            pending: t('status.pending'),
            dirty: t('status.dirty'),
            saved: t('status.saved'),
            errorRow: t('status.error'),
          }}
        />
      )}
    </div>
  )
}
