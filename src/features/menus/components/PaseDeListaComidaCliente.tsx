'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AsistenciaDayPicker } from '@/features/asistencia/components/AsistenciaDayPicker'
import { modoDeFecha } from '@/features/asistencia/lib/modo-fecha'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { PaseDeListaTable } from '@/shared/components/pase-de-lista/PaseDeListaTable'
import type { PaseDeListaItem } from '@/shared/components/pase-de-lista/types'

import { batchRegistrarComidasPlatos } from '../actions/batch-registrar-comidas-platos'
import { ESCALA_1_5_OPTIONS } from '../lib/escala'
import type {
  CantidadComida,
  MenuDiaRow,
  MomentoComida,
  PaseDeListaComidaState,
  TipoPlatoComida,
} from '../types'

const MOMENTOS: MomentoComida[] = ['desayuno', 'media_manana', 'comida', 'merienda']

type ValorComida = {
  cantidad_primero: CantidadComida | null
  cantidad_segundo: CantidadComida | null
  cantidad_postre: CantidadComida | null
  cantidad_unico: CantidadComida | null
} & Record<string, unknown>

interface NinoCellData {
  id: string
  nombre: string
  apellidos: string
  foto_url: string | null
  alergiaGrave: boolean
}

interface Props {
  aulaId: string
  fecha: string
  momento: MomentoComida
  state: PaseDeListaComidaState
  locale: string
}

const ESCALA_OPTIONS = ESCALA_1_5_OPTIONS as ReadonlyArray<{
  value: CantidadComida
  label: string
}>

export function PaseDeListaComidaCliente({ aulaId, fecha, momento, state, locale }: Props) {
  const t = useTranslations('menus.pase_de_lista')
  const tEmpty = useTranslations('menus.empty')
  const tTipos = useTranslations('calendario.tipos')
  const tToast = useTranslations()
  const router = useRouter()
  const hoy = hoyMadrid()
  const modo = modoDeFecha(fecha)

  const handleChangeFecha = (nueva: string) => {
    router.push(`/${locale}/teacher/aula/${aulaId}/comida?fecha=${nueva}&momento=${momento}`)
  }

  const handleChangeMomento = (m: MomentoComida) => {
    router.push(`/${locale}/teacher/aula/${aulaId}/comida?fecha=${fecha}&momento=${m}`)
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <h1 className="text-h2 text-foreground">{t('title')}</h1>
        <div
          role="tablist"
          aria-label={t('selector_momento_label')}
          className="flex flex-wrap gap-2"
        >
          {MOMENTOS.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={m === momento}
              data-testid={`tab-momento-${m}`}
              onClick={() => handleChangeMomento(m)}
              className={[
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                m === momento
                  ? 'border-primary-500 bg-primary-100 text-primary-800'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              ].join(' ')}
            >
              {t(`momentos.${m}`)}
            </button>
          ))}
        </div>
        <AsistenciaDayPicker
          fecha={fecha}
          hoy={hoy}
          modo={modo}
          locale={locale}
          onChange={handleChangeFecha}
        />
      </header>

      <ContenidoPaseDeLista
        aulaId={aulaId}
        fecha={fecha}
        momento={momento}
        state={state}
        modo={modo}
        renderEmpty={(key, params) => {
          if (key === 'centro_cerrado') {
            return (
              <Card>
                <CardContent>
                  <div className="space-y-1 text-center">
                    <h3 className="text-foreground font-semibold">
                      {tEmpty('centro_cerrado.title')}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {tEmpty('centro_cerrado.descripcion', {
                        tipo: tTipos(params.tipo!),
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          }
          if (key === 'sin_plantilla_publicada') {
            return (
              <Card>
                <CardContent>
                  <div className="space-y-1 text-center">
                    <h3 className="text-foreground font-semibold">
                      {tEmpty('sin_plantilla_publicada.title')}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {tEmpty('sin_plantilla_publicada.descripcion')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          }
          if (key === 'dia_sin_menu') {
            return (
              <Card>
                <CardContent>
                  <div className="space-y-1 text-center">
                    <h3 className="text-foreground font-semibold">
                      {tEmpty('dia_sin_menu.title')}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {tEmpty('dia_sin_menu.descripcion')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          }
          if (key === 'sin_ninos_solidos') {
            return (
              <Card>
                <CardContent>
                  <div className="space-y-1 text-center">
                    <p className="text-muted-foreground text-sm">{tEmpty('sin_ninos_solidos')}</p>
                  </div>
                </CardContent>
              </Card>
            )
          }
          return null
        }}
      />
    </div>
  )

  function ContenidoPaseDeLista({
    aulaId: _aulaId,
    fecha: _fecha,
    momento: _momento,
    state,
    modo,
    renderEmpty,
  }: {
    aulaId: string
    fecha: string
    momento: MomentoComida
    state: PaseDeListaComidaState
    modo: 'hoy' | 'historico' | 'futuro'
    renderEmpty: (
      key: 'centro_cerrado' | 'sin_plantilla_publicada' | 'dia_sin_menu' | 'sin_ninos_solidos',
      params: { tipo?: string }
    ) => React.ReactNode
  }) {
    if (state.kind === 'centro_cerrado') return renderEmpty('centro_cerrado', { tipo: state.tipo })
    if (state.kind === 'sin_plantilla_publicada') return renderEmpty('sin_plantilla_publicada', {})
    if (state.kind === 'dia_sin_menu') return renderEmpty('dia_sin_menu', {})
    return (
      <ContenidoConMenu
        aulaId={_aulaId}
        fecha={_fecha}
        momento={_momento}
        state={state}
        modo={modo}
        renderEmpty={renderEmpty}
      />
    )
  }

  function ContenidoConMenu({
    aulaId: _aulaId,
    fecha: _fecha,
    momento: _momento,
    state,
    modo,
    renderEmpty,
  }: {
    aulaId: string
    fecha: string
    momento: MomentoComida
    state: Extract<PaseDeListaComidaState, { kind: 'listo' }>
    modo: 'hoy' | 'historico' | 'futuro'
    renderEmpty: (
      key: 'centro_cerrado' | 'sin_plantilla_publicada' | 'dia_sin_menu' | 'sin_ninos_solidos',
      params: { tipo?: string }
    ) => React.ReactNode
  }) {
    const { menu, filas, existentes } = state
    const isComidaMomento = _momento === 'comida'

    // Indexa existentes para pre-cargar TValue por niño.
    const existentesPorNino = useMemo(() => {
      const m = new Map<string, Partial<ValorComida>>()
      for (const e of existentes) {
        const acc = m.get(e.nino_id) ?? {}
        if (e.tipo_plato === 'primer_plato') acc.cantidad_primero = e.cantidad
        if (e.tipo_plato === 'segundo_plato') acc.cantidad_segundo = e.cantidad
        if (e.tipo_plato === 'postre') acc.cantidad_postre = e.cantidad
        if (e.tipo_plato === 'unico') acc.cantidad_unico = e.cantidad
        m.set(e.nino_id, acc)
      }
      return m
    }, [existentes])

    const items: PaseDeListaItem<NinoCellData, ValorComida>[] = useMemo(
      () =>
        filas.map((f) => {
          const pre = existentesPorNino.get(f.nino.id) ?? {}
          const initial: ValorComida = {
            cantidad_primero: pre.cantidad_primero ?? null,
            cantidad_segundo: pre.cantidad_segundo ?? null,
            cantidad_postre: pre.cantidad_postre ?? null,
            cantidad_unico: pre.cantidad_unico ?? null,
          }
          return {
            id: f.nino.id,
            item: {
              id: f.nino.id,
              nombre: f.nino.nombre,
              apellidos: f.nino.apellidos,
              foto_url: f.nino.foto_url,
              alergiaGrave: f.alergiaGrave,
            },
            initial,
            badges: f.alergiaGrave
              ? [{ label: t('badge_alergia_grave'), variant: 'destructive' }]
              : [],
          }
        }),
      [filas, existentesPorNino]
    )

    if (items.length === 0) {
      return (
        <div className="space-y-3">
          <CabeceraMenu menu={menu} momento={_momento} />
          {renderEmpty('sin_ninos_solidos', {})}
        </div>
      )
    }

    const columns = isComidaMomento
      ? [
          {
            id: 'cantidad_primero' as const,
            label: t('platos.primer_plato'),
            type: 'enum-badges' as const,
            options: ESCALA_OPTIONS,
          },
          {
            id: 'cantidad_segundo' as const,
            label: t('platos.segundo_plato'),
            type: 'enum-badges' as const,
            options: ESCALA_OPTIONS,
          },
          {
            id: 'cantidad_postre' as const,
            label: t('platos.postre'),
            type: 'enum-badges' as const,
            options: ESCALA_OPTIONS,
          },
        ]
      : [
          {
            id: 'cantidad_unico' as const,
            label: t('platos.unico'),
            type: 'enum-badges' as const,
            options: ESCALA_OPTIONS,
          },
        ]

    const quickActions = columns.map((col) => ({
      id: `todos-${col.id}`,
      label: t('quick.aplicar_a_todos_a_columna', { columna: col.label, valor: '5' }),
      apply: () => ({ [col.id]: 'todo' as CantidadComida }) as Partial<ValorComida>,
    }))

    return (
      <div className="space-y-4">
        <CabeceraMenu menu={menu} momento={_momento} />
        <PaseDeListaTable<NinoCellData, ValorComida>
          items={items}
          renderItem={(item) => (
            <span className="text-foreground font-medium">
              {item.nombre} {item.apellidos}
            </span>
          )}
          columns={columns}
          quickActions={quickActions}
          readOnly={modo !== 'hoy'}
          submitLabel={t('guardar')}
          ariaLabel={t('title')}
          i18n={{
            pending: t('estado.pendiente'),
            dirty: t('estado.sin_guardar'),
            saved: t('estado.guardado'),
            errorRow: t('estado.error'),
          }}
          onBatchSubmit={async (rows) => {
            const filas: Array<{
              nino_id: string
              tipo_plato: TipoPlatoComida
              cantidad: CantidadComida
              descripcion: string | null
            }> = []

            for (const r of rows) {
              if (isComidaMomento) {
                if (r.value.cantidad_primero) {
                  filas.push({
                    nino_id: r.id,
                    tipo_plato: 'primer_plato',
                    cantidad: r.value.cantidad_primero,
                    descripcion: menu.comida_primero,
                  })
                }
                if (r.value.cantidad_segundo) {
                  filas.push({
                    nino_id: r.id,
                    tipo_plato: 'segundo_plato',
                    cantidad: r.value.cantidad_segundo,
                    descripcion: menu.comida_segundo,
                  })
                }
                if (r.value.cantidad_postre) {
                  filas.push({
                    nino_id: r.id,
                    tipo_plato: 'postre',
                    cantidad: r.value.cantidad_postre,
                    descripcion: menu.comida_postre,
                  })
                }
              } else if (r.value.cantidad_unico) {
                const descripcion =
                  _momento === 'desayuno'
                    ? menu.desayuno
                    : _momento === 'media_manana'
                      ? menu.media_manana
                      : menu.merienda
                filas.push({
                  nino_id: r.id,
                  tipo_plato: 'unico',
                  cantidad: r.value.cantidad_unico,
                  descripcion,
                })
              }
            }

            if (filas.length === 0) {
              return { success: false, error: 'menus.toasts.nada_que_guardar' }
            }

            const result = await batchRegistrarComidasPlatos({
              fecha: _fecha,
              momento: _momento,
              menu_dia_id: menu.id,
              filas,
            })
            if (result.success) {
              return { success: true }
            }
            return { success: false, error: tToast(result.error) }
          }}
        />
      </div>
    )
  }

  function CabeceraMenu({ menu, momento }: { menu: MenuDiaRow; momento: MomentoComida }) {
    if (momento === 'comida') {
      return (
        <div className="bg-primary-50 border-primary-200 grid gap-1 rounded-2xl border p-3 text-sm">
          <Linea label={t('platos.primer_plato')} valor={menu.comida_primero} />
          <Linea label={t('platos.segundo_plato')} valor={menu.comida_segundo} />
          <Linea label={t('platos.postre')} valor={menu.comida_postre} />
        </div>
      )
    }
    const valor =
      momento === 'desayuno'
        ? menu.desayuno
        : momento === 'media_manana'
          ? menu.media_manana
          : menu.merienda
    return (
      <div className="bg-primary-50 border-primary-200 rounded-2xl border p-3 text-sm">
        <Linea label={t(`momentos.${momento}`)} valor={valor} />
      </div>
    )
  }

  function Linea({ label, valor }: { label: string; valor: string | null }) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{label}</Badge>
        <span className="text-foreground">{valor ?? '—'}</span>
      </div>
    )
  }
}
