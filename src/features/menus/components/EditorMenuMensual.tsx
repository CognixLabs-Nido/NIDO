'use client'

import { CheckCircle2Icon, SendIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  isoYmd as isoYmdCalendario,
  tipoResuelto,
} from '@/features/calendario-centro/lib/calendario-grid'
import { tipoAbreElCentro } from '@/features/calendario-centro/lib/tipo-default'
import type { OverrideMes } from '@/features/calendario-centro/types'
import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'

import { guardarMenuMes } from '../actions/guardar-menu-mes'
import { publicarPlantilla } from '../actions/publicar-plantilla'
import type { MenuDiaInput } from '../schemas/menu'
import type { EstadoPlantilla, MenuDiaRow, PlantillaMenuRow } from '../types'

import { PanelEdicionMenuDia } from './PanelEdicionMenuDia'

type CamposMenu = Omit<MenuDiaInput, 'fecha'>

const CAMPOS_VACIOS: CamposMenu = {
  desayuno: null,
  media_manana: null,
  comida_primero: null,
  comida_segundo: null,
  comida_postre: null,
  merienda: null,
}

interface Props {
  plantilla: PlantillaMenuRow
  menus: MenuDiaRow[]
  overridesCalendario: OverrideMes[]
  locale: 'es' | 'en' | 'va'
  backHref: string
}

function rowToCampos(r: MenuDiaRow): CamposMenu {
  return {
    desayuno: r.desayuno,
    media_manana: r.media_manana,
    comida_primero: r.comida_primero,
    comida_segundo: r.comida_segundo,
    comida_postre: r.comida_postre,
    merienda: r.merienda,
  }
}

function camposEquals(a: CamposMenu, b: CamposMenu): boolean {
  return (
    a.desayuno === b.desayuno &&
    a.media_manana === b.media_manana &&
    a.comida_primero === b.comida_primero &&
    a.comida_segundo === b.comida_segundo &&
    a.comida_postre === b.comida_postre &&
    a.merienda === b.merienda
  )
}

/**
 * Editor de menú mensual. Cliente que mantiene un estado local con
 * todos los cambios pendientes ("dirty"), los muestra visualmente en
 * el calendario, y los persiste de golpe al pulsar "Guardar mes".
 *
 * Días cerrados según `centro_abierto` (resuelto via overrides + default
 * de F4.5a) NO son clickables para editar — se muestra atenuado + tooltip
 * "Centro cerrado este día". El click sobre días abiertos abre el
 * Dialog `<PanelEdicionMenuDia />`.
 */
export function EditorMenuMensual({
  plantilla,
  menus,
  overridesCalendario,
  locale,
  backHref,
}: Props) {
  const t = useTranslations('menus.editor')
  const tConfirm = useTranslations('menus.editor.confirmar_publicar')
  const tTipos = useTranslations('calendario.tipos')
  const tToast = useTranslations()

  // Mapa fecha → datos persistidos al cargar.
  const persistido = useMemo(() => {
    const m = new Map<string, CamposMenu>()
    for (const r of menus) m.set(r.fecha, rowToCampos(r))
    return m
  }, [menus])

  // Estado local dirty: solo claves modificadas. Si una clave no está,
  // significa "no tocada → usar persistido".
  const [dirty, setDirty] = useState<Map<string, CamposMenu>>(new Map())

  const [mes, setMes] = useState(plantilla.mes)
  const [anio, setAnio] = useState(plantilla.anio)
  const [diaActivo, setDiaActivo] = useState<Date | null>(null)
  const [confirmarPublicar, setConfirmarPublicar] = useState(false)
  const [pending, startTransition] = useTransition()

  const overrideCalMap = useMemo(
    () =>
      new Map(
        overridesCalendario.map((o) => [o.fecha, { tipo: o.tipo, observaciones: o.observaciones }])
      ),
    [overridesCalendario]
  )

  function valoresPara(fecha: string): CamposMenu {
    if (dirty.has(fecha)) return dirty.get(fecha)!
    return persistido.get(fecha) ?? CAMPOS_VACIOS
  }

  function abrirPanel(fecha: Date) {
    setDiaActivo(fecha)
  }

  function actualizarCampo(campo: keyof CamposMenu, valor: string | null) {
    if (!diaActivo) return
    const ymd = isoYmdCalendario(diaActivo)
    setDirty((prev) => {
      const next = new Map(prev)
      const actual = next.get(ymd) ?? persistido.get(ymd) ?? CAMPOS_VACIOS
      const nuevo = { ...actual, [campo]: valor }
      const base = persistido.get(ymd) ?? CAMPOS_VACIOS
      if (camposEquals(nuevo, base)) {
        // Volvió al estado original — quitar de dirty.
        next.delete(ymd)
      } else {
        next.set(ymd, nuevo)
      }
      return next
    })
  }

  function cerrarPanel() {
    setDiaActivo(null)
  }

  const diasDirty = dirty.size
  const totalDefinidos = useMemo(() => {
    const fechas = new Set<string>([...persistido.keys(), ...dirty.keys()])
    let count = 0
    for (const f of fechas) {
      const v = valoresPara(f)
      const algoLleno =
        v.desayuno ||
        v.media_manana ||
        v.comida_primero ||
        v.comida_segundo ||
        v.comida_postre ||
        v.merienda
      if (algoLleno) count++
    }
    return count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, persistido])

  async function guardarMes() {
    if (diasDirty === 0) return
    startTransition(async () => {
      const payload = Array.from(dirty.entries()).map(([fecha, valores]) => ({
        fecha,
        ...valores,
      }))
      const r = await guardarMenuMes({
        plantilla_id: plantilla.id,
        menus: payload,
      })
      if (r.success) {
        toast.success(t('toasts_inline.guardado_mes', { count: r.data.count }))
        setDirty(new Map())
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  async function publicar() {
    setConfirmarPublicar(false)
    startTransition(async () => {
      const r = await publicarPlantilla({ plantilla_id: plantilla.id })
      if (r.success) {
        toast.success(t('toasts_inline.publicado'))
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  const estado: EstadoPlantilla = plantilla.estado
  const camposActivos = diaActivo ? valoresPara(isoYmdCalendario(diaActivo)) : CAMPOS_VACIOS
  const diaActivoTipo = diaActivo ? tipoResuelto(diaActivo, overrideCalMap) : null

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={backHref}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            ← {t('volver_listado')}
          </Link>
          <h1 className="text-h2 text-foreground flex items-center gap-2">
            {t('title', {
              mes: new Intl.DateTimeFormat(
                locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
                { month: 'long' }
              ).format(new Date(plantilla.anio, plantilla.mes - 1, 1)),
              anio: plantilla.anio,
            })}
            <EstadoBadge estado={estado} />
          </h1>
          {diasDirty > 0 && (
            <p className="text-warning-600 text-sm" data-testid="dirty-indicator">
              {t('cambios_sin_guardar', { count: diasDirty })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={guardarMes}
            disabled={pending || diasDirty === 0}
            data-testid="guardar-mes"
          >
            <CheckCircle2Icon className="size-4" />
            {t('guardar_mes')}
          </Button>
          {estado === 'borrador' && (
            <Button
              type="button"
              onClick={() => setConfirmarPublicar(true)}
              disabled={pending || diasDirty > 0}
              data-testid="abrir-publicar"
            >
              <SendIcon className="size-4" />
              {t('publicar')}
            </Button>
          )}
        </div>
      </header>

      <CalendarioMensual
        mes={mes}
        anio={anio}
        diaActivo={diaActivo}
        onCambioMes={(m, a) => {
          // Solo permitimos navegar al mes de la plantilla (no a otros meses).
          if (m === plantilla.mes && a === plantilla.anio) {
            setMes(m)
            setAnio(a)
          }
        }}
        locale={locale}
        ariaLabel={t('title', {
          mes: String(plantilla.mes),
          anio: plantilla.anio,
        })}
        labels={{ anterior: t('selector_prev'), siguiente: t('selector_next') }}
        renderDia={(fecha, dentroDelMes) => {
          if (!dentroDelMes) {
            return <span className="text-foreground text-sm">{fecha.getDate()}</span>
          }
          const tipo = tipoResuelto(fecha, overrideCalMap)
          const abierto = tipoAbreElCentro(tipo)
          const ymd = isoYmdCalendario(fecha)
          const valores = valoresPara(ymd)
          const tieneMenu = Boolean(
            valores.desayuno ||
            valores.media_manana ||
            valores.comida_primero ||
            valores.comida_segundo ||
            valores.comida_postre ||
            valores.merienda
          )
          const esDirty = dirty.has(ymd)
          if (!abierto) {
            return (
              <div
                className="bg-muted/60 flex h-full flex-col rounded-md border border-transparent p-1 opacity-60"
                title={t('celda_cerrado_tooltip', { tipo: tTipos(tipo) })}
                data-tipo-dia={tipo}
                data-cerrado="true"
              >
                <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
                <span className="text-muted-foreground mt-auto truncate text-[10px]">
                  {tTipos(tipo)}
                </span>
              </div>
            )
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                abrirPanel(fecha)
              }}
              data-testid={`menu-celda-${ymd}`}
              data-tiene-menu={tieneMenu ? 'true' : 'false'}
              data-dirty={esDirty ? 'true' : 'false'}
              className={[
                'hover:bg-primary-50 flex h-full w-full flex-col rounded-md border p-1 text-left transition-colors',
                tieneMenu ? 'bg-primary-50 border-primary-200' : 'border-border/60 bg-transparent',
                esDirty ? 'ring-warning-400 border-warning-400 ring-2' : '',
              ].join(' ')}
            >
              <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
              {tieneMenu && (
                <span className="text-muted-foreground mt-auto line-clamp-2 text-[10px]">
                  {valores.comida_primero ?? valores.desayuno ?? t('celda_sin_definir')}
                </span>
              )}
              {!tieneMenu && (
                <span className="text-muted-foreground mt-auto text-[10px] italic">
                  {t('celda_sin_definir')}
                </span>
              )}
              {esDirty && <span className="sr-only">{t('celda_sin_guardar')}</span>}
            </button>
          )
        }}
      />

      <PanelEdicionMenuDia
        open={diaActivo !== null && diaActivoTipo !== null && tipoAbreElCentro(diaActivoTipo)}
        fecha={diaActivo}
        values={camposActivos}
        locale={locale}
        onChange={actualizarCampo}
        onClose={cerrarPanel}
        onDone={cerrarPanel}
      />

      <Dialog open={confirmarPublicar} onOpenChange={(o) => !o && setConfirmarPublicar(false)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tConfirm('title')}</DialogTitle>
            <DialogDescription>
              {tConfirm('descripcion', { dias: totalDefinidos })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmarPublicar(false)}
              disabled={pending}
            >
              {tConfirm('no')}
            </Button>
            <Button
              type="button"
              onClick={publicar}
              disabled={pending}
              data-testid="confirmar-publicar"
            >
              {tConfirm('si')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoPlantilla }) {
  const t = useTranslations('menus.estado')
  const variant: 'warm' | 'success' | 'secondary' =
    estado === 'borrador' ? 'warm' : estado === 'publicada' ? 'success' : 'secondary'
  return <Badge variant={variant}>{t(estado)}</Badge>
}
