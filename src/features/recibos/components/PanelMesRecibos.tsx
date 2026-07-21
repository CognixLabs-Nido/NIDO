'use client'

import { Fragment, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ReciboEsporadicoDialog } from '@/features/cierre-cobros/components/ReciboEsporadicoDialog'
import { MesSelector } from '@/features/cuotas-config/components/MesSelector'
import { CentroLogo } from '@/shared/components/brand/CentroLogo'
import { formatEuros } from '@/shared/lib/format-money'
import type { Database } from '@/types/database'

import { confirmarRecibo, confirmarRecibos } from '../actions/confirmar-recibo'
import { generarRecibosMes } from '../actions/generar-recibos-mes'
import { setMetodoPagoFamilia } from '../actions/set-metodo-pago-familia'
import { limpiarNombreEmbebido } from '../lib/limpiar-nombre-embebido'
import { agruparLineasPanel, esConfirmado, type FilaFamiliaPanel } from '../lib/panel-familia'
import type { PanelMesData } from '../queries/get-recibos-mes-panel'
import { EditarReciboDialog } from './EditarReciboDialog'

/** Logo del centro para la cabecera del recibo interno (getCentroLogo). */
export interface CentroLogoProp {
  url: string
  name: string
}

type MetodoPago = Database['public']['Enums']['metodo_pago']
const METODOS: MetodoPago[] = ['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']

interface Props {
  centroId: string
  anio: number
  mes: number
  data: PanelMesData
  ninos: Array<{ id: string; nombre: string }>
  /** Logo del centro (getCentroLogo); null si no tiene → el recibo interno va sin logo. */
  centroLogo: CentroLogoProp | null
}

export function PanelMesRecibos({ anio, mes, data, ninos, centroLogo }: Props) {
  const t = useTranslations('recibos_panel')
  const tErrors = useTranslations()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [generarOpen, setGenerarOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const borradores = data.filas.filter((f) => f.recibo && f.recibo.estado === 'borrador')
  const numBorradores = borradores.length
  const numConfirmados = data.indicadores.confirmados
  const bloqueado = data.cerrado

  function lanzarGenerar() {
    if (numBorradores > 0) setGenerarOpen(true)
    else ejecutarGenerar()
  }
  function ejecutarGenerar() {
    startTransition(async () => {
      const r = await generarRecibosMes({ anio, mes })
      setGenerarOpen(false)
      if (r.success) toast.success(t('generado_ok', { n: r.data.generados }))
      else toast.error(tErrors(r.error))
    })
  }

  function confirmarUno(reciboId: string) {
    startTransition(async () => {
      const r = await confirmarRecibo(reciboId)
      if (r.success) toast.success(r.data.cerrado ? t('confirmado_cierre') : t('confirmado_ok'))
      else toast.error(tErrors(r.error))
    })
  }

  function confirmarSeleccionados() {
    const ids = [...selected]
    startTransition(async () => {
      const r = await confirmarRecibos(ids)
      if (r.success) {
        toast.success(t('lote_ok', { n: r.data.confirmados }))
        setSelected(new Set())
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function toggleSel(reciboId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(reciboId)
      else next.delete(reciboId)
      return next
    })
  }
  function toggleExpand(familiaId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(familiaId)) next.delete(familiaId)
      else next.add(familiaId)
      return next
    })
  }
  function seleccionarTodos(on: boolean) {
    setSelected(on ? new Set(borradores.map((f) => f.recibo!.id)) : new Set())
  }
  function cambiarMetodo(familiaId: string, metodo: MetodoPago) {
    startTransition(async () => {
      const r = await setMetodoPagoFamilia(familiaId, anio, mes, metodo)
      if (r.success) toast.success(t('metodo_guardado'))
      else toast.error(tErrors(r.error))
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MesSelector anio={anio} mes={mes} tab="mes" />
        <div className="flex items-center gap-2">
          <ReciboEsporadicoDialog anio={anio} mes={mes} ninos={ninos} />
          <Button disabled={pending || bloqueado} onClick={lanzarGenerar}>
            {t('generar')}
          </Button>
        </div>
      </div>

      {/* Indicadores */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <Indicador label={t('ind_generados')} valor={String(data.indicadores.numRecibos)} />
        <Indicador
          label={t('ind_confirmados')}
          valor={`${numConfirmados}/${data.indicadores.numRecibos}`}
        />
        <Indicador label={t('ind_pendientes')} valor={String(data.indicadores.pendientes)} />
        <Indicador label={t('ind_total')} valor={formatEuros(data.indicadores.totalCentimos)} />
        {data.indicadores.familiasSinRecibo > 0 && (
          <Indicador
            label={t('ind_sin_recibo')}
            valor={String(data.indicadores.familiasSinRecibo)}
          />
        )}
        <div className="ml-auto">
          {data.cerrado ? (
            <Badge variant="secondary">{t('mes_cerrado')}</Badge>
          ) : (
            <Badge variant="warm">{t('mes_abierto')}</Badge>
          )}
        </div>
      </Card>

      {/* Barra de confirmación en lote */}
      {selected.size > 0 && (
        <Card className="flex items-center justify-between gap-3 p-3">
          <span className="text-sm">{t('seleccionados', { n: selected.size })}</span>
          <Button size="sm" disabled={pending} onClick={confirmarSeleccionados}>
            {t('confirmar_seleccionados')}
          </Button>
        </Card>
      )}

      {data.filas.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">{t('sin_familias')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    {numBorradores > 0 && !bloqueado && (
                      <Checkbox
                        aria-label={t('sel_todos')}
                        checked={selected.size === numBorradores && numBorradores > 0}
                        onCheckedChange={(c) => seleccionarTodos(c === true)}
                      />
                    )}
                  </TableHead>
                  <TableHead>{t('col_familia')}</TableHead>
                  <TableHead>{t('col_hijos')}</TableHead>
                  <TableHead>{t('col_metodo')}</TableHead>
                  <TableHead className="text-right">{t('col_cargos')}</TableHead>
                  <TableHead className="text-right">{t('col_dtos')}</TableHead>
                  <TableHead className="text-right">{t('col_total')}</TableHead>
                  <TableHead>{t('col_estado')}</TableHead>
                  <TableHead className="text-right">{t('col_acciones')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.filas.map((fila) => (
                  <FilaFamilia
                    key={fila.familiaId}
                    fila={fila}
                    bloqueado={bloqueado}
                    pending={pending}
                    centroLogo={centroLogo}
                    metodoPref={data.metodoPreferencia[fila.familiaId] ?? null}
                    seleccionado={fila.recibo ? selected.has(fila.recibo.id) : false}
                    expandido={expanded.has(fila.familiaId)}
                    onToggleSel={toggleSel}
                    onToggleExpand={() => toggleExpand(fila.familiaId)}
                    onConfirmar={confirmarUno}
                    onCambiarMetodo={cambiarMetodo}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Esporádicos del mes (read-only) */}
      {data.esporadicos.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t('esporadicos_titulo')}</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_familia')}</TableHead>
                  <TableHead>{t('col_concepto')}</TableHead>
                  <TableHead>{t('col_metodo')}</TableHead>
                  <TableHead className="text-right">{t('col_total')}</TableHead>
                  <TableHead>{t('col_estado')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.esporadicos.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.familiaEtiqueta}</TableCell>
                    <TableCell>
                      {e.concepto ?? '—'}
                      {e.esRegiro && (
                        <Badge variant="outline" className="ml-2">
                          {t('regiro')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{e.metodo ? t(`metodos.${e.metodo}`) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatEuros(e.totalCentimos)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(`estado_recibo.${e.estado}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Diálogo de regeneración destructiva */}
      <Dialog open={generarOpen} onOpenChange={setGenerarOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('generar_confirm_title')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('generar_confirm_desc', { borradores: numBorradores, confirmados: numConfirmados })}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setGenerarOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button disabled={pending} onClick={ejecutarGenerar}>
              {t('regenerar')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Indicador({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

function FilaFamilia({
  fila,
  bloqueado,
  pending,
  centroLogo,
  metodoPref,
  seleccionado,
  expandido,
  onToggleSel,
  onToggleExpand,
  onConfirmar,
  onCambiarMetodo,
}: {
  fila: FilaFamiliaPanel
  bloqueado: boolean
  pending: boolean
  centroLogo: CentroLogoProp | null
  metodoPref: MetodoPago | null
  seleccionado: boolean
  expandido: boolean
  onToggleSel: (reciboId: string, on: boolean) => void
  onToggleExpand: () => void
  onConfirmar: (reciboId: string) => void
  onCambiarMetodo: (familiaId: string, metodo: MetodoPago) => void
}) {
  const t = useTranslations('recibos_panel')
  const recibo = fila.recibo
  const esBorrador = recibo?.estado === 'borrador'
  const confirmado = recibo != null && esConfirmado(recibo.estado)
  const metodoActual = recibo?.metodo ?? metodoPref ?? undefined
  const metodoItems = METODOS.map((m) => ({ value: m, label: t(`metodos.${m}`) }))

  return (
    <>
      <TableRow className={recibo ? undefined : 'bg-accent-yellow-50/40'}>
        <TableCell>
          {esBorrador && !bloqueado && (
            <Checkbox
              aria-label={t('sel_recibo')}
              checked={seleccionado}
              onCheckedChange={(c) => onToggleSel(recibo!.id, c === true)}
            />
          )}
        </TableCell>
        <TableCell>
          <div className="font-medium">{fila.etiqueta}</div>
          {fila.tutores.length > 0 && (
            <div className="text-muted-foreground text-xs">{fila.tutores.join(' · ')}</div>
          )}
        </TableCell>
        <TableCell className="text-sm">
          {fila.hijos.map((h) => h.nombre).join(', ') || '—'}
        </TableCell>
        <TableCell>
          <Select
            items={metodoItems}
            value={metodoActual}
            onValueChange={(v) => onCambiarMetodo(fila.familiaId, v as MetodoPago)}
          >
            <SelectTrigger
              size="sm"
              className="w-44"
              disabled={pending || confirmado || bloqueado}
              aria-label={t('col_metodo')}
            >
              <SelectValue placeholder={t('sin_metodo')} />
            </SelectTrigger>
            <SelectContent>
              {metodoItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {confirmado && (
            <div className="text-muted-foreground mt-1 text-xs">{t('metodo_congelado')}</div>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {recibo ? formatEuros(recibo.cargosCentimos) : '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {recibo && recibo.descuentosCentimos !== 0 ? formatEuros(recibo.descuentosCentimos) : '—'}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {recibo ? formatEuros(recibo.totalCentimos) : '—'}
        </TableCell>
        <TableCell>
          {!recibo ? (
            <Badge variant="warning">{t('estado_sin_cargos')}</Badge>
          ) : confirmado ? (
            <Badge variant="success">{t('estado_confirmado')}</Badge>
          ) : (
            <Badge variant="warm">{t('estado_borrador')}</Badge>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-2">
            {recibo && (
              <Button size="sm" variant="ghost" onClick={onToggleExpand}>
                {expandido ? t('ocultar') : t('ver')}
              </Button>
            )}
            {esBorrador && !bloqueado && (
              <>
                <EditarReciboDialog
                  reciboId={recibo!.id}
                  lineas={recibo!.lineas}
                  hijos={fila.hijos}
                />
                <Button size="sm" disabled={pending} onClick={() => onConfirmar(recibo!.id)}>
                  {t('confirmar')}
                </Button>
              </>
            )}
            {confirmado && <span className="text-muted-foreground text-xs">🔒</span>}
          </div>
        </TableCell>
      </TableRow>

      {expandido && recibo && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/30">
            <div className="space-y-3 p-3 text-sm">
              {/* Logo del centro (recibo interno del director); se omite si no lo tiene. */}
              {centroLogo && (
                <CentroLogo url={centroLogo.url} name={centroLogo.name} width={120} height={32} />
              )}

              {recibo.lineas.length === 0 ? (
                <span className="text-muted-foreground">{t('sin_lineas')}</span>
              ) : (
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 gap-y-1">
                  {/* Cabecera de columnas. */}
                  <span className="text-muted-foreground text-xs">{t('col_concepto')}</span>
                  <span className="text-muted-foreground text-right text-xs">
                    {t('col_cantidad')}
                  </span>
                  <span className="text-muted-foreground text-right text-xs">
                    {t('col_precio')}
                  </span>
                  <span className="text-muted-foreground text-right text-xs">
                    {t('col_importe')}
                  </span>

                  {agruparLineasPanel(recibo.lineas).map((grupo) => (
                    <FragmentoGrupo key={grupo.ninoId ?? 'familiar'} grupo={grupo} />
                  ))}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// Un bloque del recibo interno: el nombre del niño UNA vez como cabecera + sus líneas
// (concepto · cantidad · precio · importe). Limpieza defensiva del nombre embebido por si
// el recibo es anterior a B3 y aún no se ha regenerado.
function FragmentoGrupo({ grupo }: { grupo: ReturnType<typeof agruparLineasPanel>[number] }) {
  const t = useTranslations('recibos_panel')
  const primerNombre = grupo.ninoNombre?.split(' ')[0] ?? null
  return (
    <>
      <div className="col-span-4 pt-1 font-medium">{grupo.ninoNombre ?? t('familiar')}</div>
      {grupo.lineas.map((l) => (
        <Fragment key={l.id}>
          <span className="pl-3">{limpiarNombreEmbebido(l.descripcion, primerNombre)}</span>
          <span className="text-right tabular-nums">{l.cantidad}</span>
          <span className="text-right tabular-nums">{formatEuros(l.precioUnitarioCentimos)}</span>
          <span className="text-right font-medium tabular-nums">
            {formatEuros(l.importeCentimos)}
          </span>
        </Fragment>
      ))}
    </>
  )
}
