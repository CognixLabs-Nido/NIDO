'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { PaseDeListaTable } from '@/shared/components/pase-de-lista/PaseDeListaTable'
import type {
  PaseDeListaColumn,
  PaseDeListaItem,
  PaseDeListaQuickAction,
} from '@/shared/components/pase-de-lista/types'

import { batchUpsertParteServicio } from '../actions/batch-upsert-parte-servicio'
import type { ServicioDiario } from '../schemas/parte-servicio'
import type { NinoParteResumen } from '../types'

import { ServicioDayPicker, type ModoFechaServicio } from './ServicioDayPicker'

const SERVICIOS: ServicioDiario[] = ['comedor', 'matinera', 'vespertina']

// Intersección con Record<string, unknown> para casar con el constraint del
// componente genérico, manteniendo el tipo concreto de la celda.
type ParteValue = { presente: 'si' | 'no' | '' } & Record<string, unknown>

interface Props {
  centroId: string
  locale: string
  fecha: string
  filas: NinoParteResumen[]
}

function modoDeFecha(fecha: string, hoy: string): ModoFechaServicio {
  if (fecha === hoy) return 'hoy'
  if (fecha < hoy) return 'historico'
  return 'futuro'
}

export function PaseDeListaServicioCliente({ centroId, locale, fecha, filas }: Props) {
  const t = useTranslations('parte_servicio')
  const router = useRouter()
  const hoy = hoyMadrid()
  const modo = modoDeFecha(fecha, hoy)
  // Hoy y días pasados editan; el futuro es solo lectura.
  const editable = modo !== 'futuro'
  const [servicio, setServicio] = useState<ServicioDiario>('comedor')

  function setFecha(nueva: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', nueva)
    router.push(url.pathname + url.search)
  }

  const items: PaseDeListaItem<NinoParteResumen['nino'], ParteValue>[] = filas.map((f) => {
    const estado = f.servicios[servicio]
    return {
      id: f.nino.id,
      item: f.nino,
      initial: estado === null ? null : { presente: estado ? 'si' : 'no' },
    }
  })

  const columns: PaseDeListaColumn<ParteValue>[] = [
    {
      id: 'presente',
      label: t('columna.presente'),
      type: 'radio',
      width: '220px',
      options: [
        { value: 'si', label: t('opciones.si') },
        { value: 'no', label: t('opciones.no') },
      ],
    },
  ]

  const quickActions: PaseDeListaQuickAction<ParteValue>[] = [
    {
      id: 'todos-se-quedan',
      label: t('quick_actions.todos_se_quedan'),
      apply: () => ({ presente: 'si' }),
      onlyClean: true,
    },
  ]

  async function onBatchSubmit(
    rows: Array<{ id: string; item: NinoParteResumen['nino']; value: ParteValue }>
  ): Promise<{ success: boolean; error?: string }> {
    const result = await batchUpsertParteServicio({
      centro_id: centroId,
      fecha,
      servicio,
      items: rows.map((r) => ({ nino_id: r.id, presente: r.value.presente === 'si' })),
    })
    if (result.success) {
      router.refresh()
      return { success: true }
    }
    return { success: false, error: result.error }
  }

  return (
    <div className="space-y-4">
      <ServicioDayPicker fecha={fecha} locale={locale} hoy={hoy} modo={modo} onChange={setFecha} />

      <div
        role="tablist"
        aria-label={t('selector_servicio_label')}
        className="flex flex-wrap gap-2"
      >
        {SERVICIOS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === servicio}
            data-testid={`tab-servicio-${s}`}
            onClick={() => setServicio(s)}
            className={[
              'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              s === servicio
                ? 'border-primary-500 bg-primary-100 text-primary-800'
                : 'border-border bg-card text-foreground hover:bg-muted',
            ].join(' ')}
          >
            {t(`servicios.${s}`)}
          </button>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">{t('ayuda')}</p>

      {filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('ningun_nino')}</p>
      ) : (
        <PaseDeListaTable
          key={servicio}
          ariaLabel={t('servicios.' + servicio)}
          items={items}
          renderItem={(nino) => (
            <span className="text-foreground text-sm font-medium">
              {nino.nombre} {nino.apellidos}
            </span>
          )}
          columns={columns}
          quickActions={editable ? quickActions : []}
          onBatchSubmit={onBatchSubmit}
          readOnly={!editable}
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
