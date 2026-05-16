'use client'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'

import { aplicarTipoARango } from '../actions/aplicar-tipo-a-rango'
import { eliminarDiaCentro } from '../actions/eliminar-dia-centro'
import { upsertDiaCentro } from '../actions/upsert-dia-centro'
import { isoYmd, tipoResuelto, type OverrideMap } from '../lib/calendario-grid'
import { COLORES_TIPO, TIPOS_ORDEN } from '../lib/colores-tipo'
import type { TipoDiaCentro } from '../schemas/dia-centro'
import type { OverrideMes } from '../types'

interface Props {
  centroId: string
  /** Mes inicial (1-12). */
  mesInicial: number
  /** Año inicial (4 dígitos). */
  anioInicial: number
  /** Overrides pre-cargados para el grid mensual. */
  overrides: OverrideMes[]
  locale: 'es' | 'en' | 'va'
}

function buildOverrideMap(overrides: OverrideMes[]): OverrideMap {
  return new Map(overrides.map((o) => [o.fecha, { tipo: o.tipo, observaciones: o.observaciones }]))
}

/** Cuenta días inclusivo entre dos fechas. */
function contarDias(desde: Date, hasta: Date): number {
  const d = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1
  return d > 0 ? d : 0
}

export function CalendarioCentroEditor({
  centroId,
  mesInicial,
  anioInicial,
  overrides,
  locale,
}: Props) {
  const t = useTranslations('calendario')
  const tToast = useTranslations()
  const [mes, setMes] = useState(mesInicial)
  const [anio, setAnio] = useState(anioInicial)
  const [diaActivo, setDiaActivo] = useState<Date | null>(null)

  // Diálogos
  const [diaEnEdicion, setDiaEnEdicion] = useState<Date | null>(null)
  const [tipoSeleccionadoDia, setTipoSeleccionadoDia] = useState<TipoDiaCentro>('lectivo')
  const [observacionesDia, setObservacionesDia] = useState('')

  const [rangoPendiente, setRangoPendiente] = useState<{ desde: Date; hasta: Date } | null>(null)
  const [tipoSeleccionadoRango, setTipoSeleccionadoRango] = useState<TipoDiaCentro>('lectivo')
  const [observacionesRango, setObservacionesRango] = useState('')

  const [pending, startTransition] = useTransition()

  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides])

  function abrirDialogDia(fecha: Date) {
    const ymd = isoYmd(fecha)
    const existente = overrideMap.get(ymd)
    setDiaEnEdicion(fecha)
    setTipoSeleccionadoDia(existente?.tipo ?? tipoResuelto(fecha, overrideMap))
    setObservacionesDia(existente?.observaciones ?? '')
    setDiaActivo(fecha)
  }

  function abrirDialogRango(desde: Date, hasta: Date) {
    const min = desde < hasta ? desde : hasta
    const max = desde < hasta ? hasta : desde
    setRangoPendiente({ desde: min, hasta: max })
    setTipoSeleccionadoRango('lectivo')
    setObservacionesRango('')
  }

  function cerrarDialogDia() {
    setDiaEnEdicion(null)
  }

  function cerrarDialogRango() {
    setRangoPendiente(null)
  }

  function guardarDia() {
    if (!diaEnEdicion) return
    startTransition(async () => {
      const r = await upsertDiaCentro({
        centro_id: centroId,
        fecha: isoYmd(diaEnEdicion),
        tipo: tipoSeleccionadoDia,
        observaciones: observacionesDia.trim() === '' ? null : observacionesDia.trim(),
      })
      if (r.success) {
        toast.success(t('toasts.guardado'))
        cerrarDialogDia()
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  function eliminarDia() {
    if (!diaEnEdicion) return
    startTransition(async () => {
      const r = await eliminarDiaCentro({
        centro_id: centroId,
        fecha: isoYmd(diaEnEdicion),
      })
      if (r.success) {
        toast.success(t('toasts.eliminado'))
        cerrarDialogDia()
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  function aplicarRango() {
    if (!rangoPendiente) return
    startTransition(async () => {
      const r = await aplicarTipoARango({
        centro_id: centroId,
        desde: isoYmd(rangoPendiente.desde),
        hasta: isoYmd(rangoPendiente.hasta),
        tipo: tipoSeleccionadoRango,
        observaciones: observacionesRango.trim() === '' ? null : observacionesRango.trim(),
      })
      if (r.success) {
        toast.success(t('toasts.guardado_rango', { dias: r.data.dias }))
        cerrarDialogRango()
        setDiaActivo(null)
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  const existeFila = diaEnEdicion ? overrideMap.has(isoYmd(diaEnEdicion)) : false
  const diasEnRango = rangoPendiente ? contarDias(rangoPendiente.desde, rangoPendiente.hasta) : 0

  return (
    <div className="space-y-4">
      <CalendarioMensual
        mes={mes}
        anio={anio}
        diaActivo={diaActivo}
        rangoSeleccionado={rangoPendiente}
        onCambioMes={(m, a) => {
          setMes(m)
          setAnio(a)
        }}
        onClickDia={(fecha) => abrirDialogDia(fecha)}
        onSeleccionRango={(desde, hasta) => abrirDialogRango(desde, hasta)}
        locale={locale}
        ariaLabel={t('title')}
        labels={{ anterior: t('selector.anterior'), siguiente: t('selector.siguiente') }}
        renderDia={(fecha, dentroDelMes) => {
          const tipo = tipoResuelto(fecha, overrideMap)
          const cls = COLORES_TIPO[tipo].cell
          const persistido = overrideMap.has(isoYmd(fecha))
          return (
            <div
              data-tipo={tipo}
              data-persistido={persistido ? 'true' : 'false'}
              className={`flex h-full flex-col rounded-md border p-1 ${dentroDelMes ? cls : 'border-transparent bg-transparent'}`}
            >
              <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
              {persistido && (
                <span className="text-muted-foreground mt-auto truncate text-[10px]">
                  {t(`tipos.${tipo}`)}
                </span>
              )}
            </div>
          )
        }}
      />

      {/* Dialog: editar un día */}
      <Dialog
        open={diaEnEdicion !== null}
        onOpenChange={(o) => {
          if (!o) cerrarDialogDia()
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {diaEnEdicion
                ? t('popover_dia.title', {
                    fecha: new Intl.DateTimeFormat(
                      locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
                      { dateStyle: 'full' }
                    ).format(diaEnEdicion),
                  })
                : t('popover_dia.title', { fecha: '' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="tipo-dia">
                {t('popover_dia.tipo_label')}
              </label>
              <Select
                value={tipoSeleccionadoDia}
                onValueChange={(v) => setTipoSeleccionadoDia(v as TipoDiaCentro)}
              >
                <SelectTrigger data-testid="select-tipo-dia" id="tipo-dia">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ORDEN.map((tipo) => (
                    <SelectItem key={tipo} value={tipo} data-testid={`option-tipo-${tipo}`}>
                      {t(`tipos.${tipo}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="obs-dia">
                {t('popover_dia.observaciones_label')}
              </label>
              <Textarea
                id="obs-dia"
                rows={2}
                maxLength={500}
                value={observacionesDia}
                onChange={(e) => setObservacionesDia(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {existeFila && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={eliminarDia}
                  disabled={pending}
                  data-testid="btn-eliminar-dia"
                  className="text-coral-700 border-coral-300 hover:bg-coral-50"
                >
                  <Trash2Icon className="size-4" />
                  {t('popover_dia.eliminar')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={cerrarDialogDia} disabled={pending}>
                {t('popover_dia.cancelar')}
              </Button>
              <Button
                type="button"
                onClick={guardarDia}
                disabled={pending}
                data-testid="btn-guardar-dia"
              >
                {t('popover_dia.guardar')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: aplicar tipo a rango */}
      <Dialog
        open={rangoPendiente !== null}
        onOpenChange={(o) => {
          if (!o) cerrarDialogRango()
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('dialog_rango.title')}</DialogTitle>
            {rangoPendiente && (
              <DialogDescription data-testid="dialog-rango-resumen">
                {t('dialog_rango.resumen', {
                  dias: diasEnRango,
                  desde: new Intl.DateTimeFormat(
                    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
                    { day: 'numeric', month: 'short' }
                  ).format(rangoPendiente.desde),
                  hasta: new Intl.DateTimeFormat(
                    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
                    { day: 'numeric', month: 'short' }
                  ).format(rangoPendiente.hasta),
                })}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div
              data-testid="dialog-rango-confirmacion"
              className="bg-primary-50 border-primary-200 rounded-lg border p-3 text-sm"
            >
              {t('dialog_rango.confirmacion', {
                dias: diasEnRango,
                tipo: t(`tipos.${tipoSeleccionadoRango}`),
              })}
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="tipo-rango">
                {t('popover_dia.tipo_label')}
              </label>
              <Select
                value={tipoSeleccionadoRango}
                onValueChange={(v) => setTipoSeleccionadoRango(v as TipoDiaCentro)}
              >
                <SelectTrigger data-testid="select-tipo-rango" id="tipo-rango">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ORDEN.map((tipo) => (
                    <SelectItem key={tipo} value={tipo} data-testid={`option-rango-${tipo}`}>
                      {t(`tipos.${tipo}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="obs-rango">
                {t('popover_dia.observaciones_label')}
              </label>
              <Textarea
                id="obs-rango"
                rows={2}
                maxLength={500}
                value={observacionesRango}
                onChange={(e) => setObservacionesRango(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={cerrarDialogRango}
                disabled={pending}
              >
                {t('dialog_rango.cancelar')}
              </Button>
              <Button
                type="button"
                onClick={aplicarRango}
                disabled={pending || diasEnRango === 0}
                data-testid="btn-aplicar-rango"
              >
                {t('dialog_rango.aplicar')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
