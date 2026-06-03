'use client'

import { Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import { aplicarTipoARango } from '@/features/calendario-centro/actions/aplicar-tipo-a-rango'
import { eliminarDiaCentro } from '@/features/calendario-centro/actions/eliminar-dia-centro'
import { upsertDiaCentro } from '@/features/calendario-centro/actions/upsert-dia-centro'
import { tipoResuelto } from '@/features/calendario-centro/lib/calendario-grid'
import { COLORES_TIPO, TIPOS_ORDEN } from '@/features/calendario-centro/lib/colores-tipo'
import type { TipoDiaCentro } from '@/features/calendario-centro/schemas/dia-centro'
import type { OverrideMes } from '@/features/calendario-centro/types'
import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'

import { getEventoDetalleAction } from '../actions/get-evento-detalle'
import { indexarEventosPorDia, ymd } from '../lib/fecha-grid'
import type { EventoCalendario, EventoDetalle } from '../types'
import { EventoDetalleDialog } from './EventoDetalleDialog'
import { EventoFormDialog } from './EventoFormDialog'

interface Props {
  mesInicial: number
  anioInicial: number
  overrides: OverrideMes[]
  eventos: EventoCalendario[]
  locale: 'es' | 'en' | 'va'
  /** admin del centro → puede editar/cancelar eventos y editar días laborales (D8). */
  esAdmin: boolean
  esFamilia: boolean
  /** Centro al que aplicar la edición de días laborales (solo se usa cuando `esAdmin`). */
  centroId: string
}

/** Cuenta días inclusivo entre dos fechas. */
function contarDias(desde: Date, hasta: Date): number {
  const d = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1
  return d > 0 ? d : 0
}

/**
 * Calendario del centro con **overlay de eventos** (D10) y, para admin, **edición
 * del calendario laboral** integrada (AG-15: un único calendario en los 3 roles).
 * Reusa `<CalendarioMensual/>` y el coloreado de `dias_centro`; pinta los eventos
 * del día como chips. Click en un día → lista de sus eventos (+ botón "Editar día"
 * para admin); Shift+click (admin) → aplicar tipo a un rango. Click en un evento →
 * diálogo de detalle (carga roster/confirmación bajo demanda).
 */
export function CalendarioConEventos({
  mesInicial,
  anioInicial,
  overrides,
  eventos,
  locale,
  esAdmin,
  esFamilia,
  centroId,
}: Props) {
  const t = useTranslations('eventos')
  const tCal = useTranslations('calendario')
  const tToast = useTranslations()
  const router = useRouter()
  const [mes, setMes] = useState(mesInicial)
  const [anio, setAnio] = useState(anioInicial)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<EventoDetalle | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [eventoEnEdicion, setEventoEnEdicion] = useState<EventoCalendario | null>(null)
  const [pending, startTransition] = useTransition()

  // Edición del calendario laboral (solo admin).
  const [diaEnEdicion, setDiaEnEdicion] = useState<Date | null>(null)
  const [tipoSeleccionadoDia, setTipoSeleccionadoDia] = useState<TipoDiaCentro>('lectivo')
  const [observacionesDia, setObservacionesDia] = useState('')
  const [rangoPendiente, setRangoPendiente] = useState<{ desde: Date; hasta: Date } | null>(null)
  const [tipoSeleccionadoRango, setTipoSeleccionadoRango] = useState<TipoDiaCentro>('lectivo')
  const [observacionesRango, setObservacionesRango] = useState('')

  const overrideMap = useMemo(
    () =>
      new Map(overrides.map((o) => [o.fecha, { tipo: o.tipo, observaciones: o.observaciones }])),
    [overrides]
  )
  const eventosPorDia = useMemo(() => indexarEventosPorDia(eventos), [eventos])

  const hoyYmd = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(new Date())
  }, [])

  const eventosDelDia = diaSel ? (eventosPorDia.get(diaSel) ?? []) : []

  function abrirDetalle(eventoId: string) {
    startTransition(async () => {
      const d = await getEventoDetalleAction(eventoId)
      if (!d) return
      setDetalle(d)
      setDialogOpen(true)
    })
  }

  function recargarDetalle() {
    if (!detalle) return
    const id = detalle.evento.id
    startTransition(async () => {
      const d = await getEventoDetalleAction(id)
      setDetalle(d)
      router.refresh()
    })
  }

  // --- Edición de días laborales (admin) -------------------------------------
  function abrirDialogDia(fecha: Date) {
    const clave = ymd(fecha)
    const existente = overrideMap.get(clave)
    setDiaEnEdicion(fecha)
    setTipoSeleccionadoDia(existente?.tipo ?? tipoResuelto(fecha, overrideMap))
    setObservacionesDia(existente?.observaciones ?? '')
  }

  function abrirDialogRango(desde: Date, hasta: Date) {
    const min = desde < hasta ? desde : hasta
    const max = desde < hasta ? hasta : desde
    setRangoPendiente({ desde: min, hasta: max })
    setTipoSeleccionadoRango('lectivo')
    setObservacionesRango('')
  }

  function guardarDia() {
    if (!diaEnEdicion) return
    startTransition(async () => {
      const r = await upsertDiaCentro({
        centro_id: centroId,
        fecha: ymd(diaEnEdicion),
        tipo: tipoSeleccionadoDia,
        observaciones: observacionesDia.trim() === '' ? null : observacionesDia.trim(),
      })
      if (r.success) {
        toast.success(tCal('toasts.guardado'))
        setDiaEnEdicion(null)
        router.refresh()
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  function eliminarDia() {
    if (!diaEnEdicion) return
    startTransition(async () => {
      const r = await eliminarDiaCentro({ centro_id: centroId, fecha: ymd(diaEnEdicion) })
      if (r.success) {
        toast.success(tCal('toasts.eliminado'))
        setDiaEnEdicion(null)
        router.refresh()
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
        desde: ymd(rangoPendiente.desde),
        hasta: ymd(rangoPendiente.hasta),
        tipo: tipoSeleccionadoRango,
        observaciones: observacionesRango.trim() === '' ? null : observacionesRango.trim(),
      })
      if (r.success) {
        toast.success(tCal('toasts.guardado_rango', { dias: r.data.dias }))
        setRangoPendiente(null)
        setDiaSel(null)
        router.refresh()
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  const fmtFechaLarga = new Intl.DateTimeFormat(
    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
    { dateStyle: 'full' }
  )
  const fmtFechaCorta = new Intl.DateTimeFormat(
    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
    { day: 'numeric', month: 'short' }
  )
  const existeFila = diaEnEdicion ? overrideMap.has(ymd(diaEnEdicion)) : false
  const diasEnRango = rangoPendiente ? contarDias(rangoPendiente.desde, rangoPendiente.hasta) : 0

  return (
    <div className="space-y-4">
      <CalendarioMensual
        mes={mes}
        anio={anio}
        locale={locale}
        ariaLabel={t('calendario.aria')}
        labels={{ anterior: tCal('selector.anterior'), siguiente: tCal('selector.siguiente') }}
        onCambioMes={(m, a) => {
          setMes(m)
          setAnio(a)
          setDiaSel(null)
        }}
        onClickDia={(fecha) => setDiaSel(ymd(fecha))}
        onSeleccionRango={esAdmin ? (desde, hasta) => abrirDialogRango(desde, hasta) : undefined}
        diaActivo={diaSel ? new Date(`${diaSel}T00:00:00`) : null}
        rangoSeleccionado={rangoPendiente}
        renderDia={(fecha, dentroDelMes) => {
          const tipo = tipoResuelto(fecha, overrideMap)
          const cls = COLORES_TIPO[tipo].cell
          const evs = eventosPorDia.get(ymd(fecha)) ?? []
          return (
            <div
              data-tipo={tipo}
              className={`flex h-full flex-col gap-0.5 rounded-md border p-1 ${dentroDelMes ? cls : 'border-transparent bg-transparent'}`}
            >
              <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
              {evs.slice(0, 2).map((ev) => (
                <span
                  key={ev.id}
                  className={`bg-primary-100 text-primary-800 truncate rounded px-1 text-[10px] ${ev.estado === 'cancelado' ? 'line-through opacity-60' : ''}`}
                  data-testid={`evento-chip-${ev.id}`}
                >
                  {ev.titulo}
                </span>
              ))}
              {evs.length > 2 && (
                <span className="text-muted-foreground text-[10px]">+{evs.length - 2}</span>
              )}
            </div>
          )
        }}
      />

      {diaSel && (
        <div className="space-y-2" data-testid="eventos-del-dia">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm font-medium">{diaSel}</p>
            {esAdmin && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => abrirDialogDia(new Date(`${diaSel}T00:00:00`))}
                data-testid="btn-editar-dia"
              >
                {tCal('editar_dia')}
              </Button>
            )}
          </div>
          {eventosDelDia.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('calendario.sin_eventos_dia')}</p>
          ) : (
            <ul className="space-y-1">
              {eventosDelDia.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => abrirDetalle(ev.id)}
                    className="hover:bg-muted/60 border-border flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                    data-testid={`evento-item-${ev.id}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${ev.estado === 'cancelado' ? 'line-through opacity-60' : ''}`}
                    >
                      {ev.titulo}
                    </span>
                    <span className="text-muted-foreground text-xs">{t(`tipos.${ev.tipo}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <EventoDetalleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        detalle={detalle}
        esAdmin={esAdmin}
        esFamilia={esFamilia}
        hoyYmd={hoyYmd}
        onChanged={recargarDetalle}
        onEditar={() => {
          if (!detalle) return
          setDialogOpen(false)
          setEventoEnEdicion(detalle.evento)
        }}
      />

      {eventoEnEdicion && (
        <EventoFormDialog
          key={eventoEnEdicion.id}
          modo="editar"
          locale={locale}
          evento={eventoEnEdicion}
          open
          onOpenChange={(o) => {
            if (!o) setEventoEnEdicion(null)
          }}
          onGuardado={() => setEventoEnEdicion(null)}
        />
      )}

      {/* Edición del calendario laboral (solo admin) */}
      {esAdmin && (
        <>
          <Dialog
            open={diaEnEdicion !== null}
            onOpenChange={(o) => {
              if (!o) setDiaEnEdicion(null)
            }}
          >
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>
                  {tCal('popover_dia.title', {
                    fecha: diaEnEdicion ? fmtFechaLarga.format(diaEnEdicion) : '',
                  })}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-foreground text-sm font-medium" htmlFor="tipo-dia">
                    {tCal('popover_dia.tipo_label')}
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
                          {tCal(`tipos.${tipo}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-foreground text-sm font-medium" htmlFor="obs-dia">
                    {tCal('popover_dia.observaciones_label')}
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
                      {tCal('popover_dia.eliminar')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDiaEnEdicion(null)}
                    disabled={pending}
                  >
                    {tCal('popover_dia.cancelar')}
                  </Button>
                  <Button
                    type="button"
                    onClick={guardarDia}
                    disabled={pending}
                    data-testid="btn-guardar-dia"
                  >
                    {tCal('popover_dia.guardar')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={rangoPendiente !== null}
            onOpenChange={(o) => {
              if (!o) setRangoPendiente(null)
            }}
          >
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>{tCal('dialog_rango.title')}</DialogTitle>
                {rangoPendiente && (
                  <DialogDescription data-testid="dialog-rango-resumen">
                    {tCal('dialog_rango.resumen', {
                      dias: diasEnRango,
                      desde: fmtFechaCorta.format(rangoPendiente.desde),
                      hasta: fmtFechaCorta.format(rangoPendiente.hasta),
                    })}
                  </DialogDescription>
                )}
              </DialogHeader>
              <div className="space-y-3">
                <div
                  data-testid="dialog-rango-confirmacion"
                  className="bg-primary-50 border-primary-200 rounded-lg border p-3 text-sm"
                >
                  {tCal('dialog_rango.confirmacion', {
                    dias: diasEnRango,
                    tipo: tCal(`tipos.${tipoSeleccionadoRango}`),
                  })}
                </div>
                <div className="space-y-1">
                  <label className="text-foreground text-sm font-medium" htmlFor="tipo-rango">
                    {tCal('popover_dia.tipo_label')}
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
                          {tCal(`tipos.${tipo}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-foreground text-sm font-medium" htmlFor="obs-rango">
                    {tCal('popover_dia.observaciones_label')}
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
                    onClick={() => setRangoPendiente(null)}
                    disabled={pending}
                  >
                    {tCal('dialog_rango.cancelar')}
                  </Button>
                  <Button
                    type="button"
                    onClick={aplicarRango}
                    disabled={pending || diasEnRango === 0}
                    data-testid="btn-aplicar-rango"
                  >
                    {tCal('dialog_rango.aplicar')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
