'use client'

import { Fragment, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
import { ResolverDesbordeDialog } from '@/features/beca-comedor/components/ResolverDesbordeDialog'
import { ReciboEsporadicoDialog } from '@/features/cierre-cobros/components/ReciboEsporadicoDialog'
import { MesSelector } from '@/features/cuotas-config/components/MesSelector'
import { CentroLogo } from '@/shared/components/brand/CentroLogo'
import { formatEuros } from '@/shared/lib/format-money'
import type { Database } from '@/types/database'

import { confirmarRecibo, confirmarRecibos } from '../actions/confirmar-recibo'
import { desconfirmarRecibo } from '../actions/desconfirmar-recibo'
import { generarRecibosMes } from '../actions/generar-recibos-mes'
import { recalcularMes } from '../actions/recalcular-mes'
import { setMetodoPagoFamilia } from '../actions/set-metodo-pago-familia'
import { accesoModificar } from '../lib/acceso-modificar'
import {
  borradoresVisibles,
  filtrarPanel,
  opcionesFamilia,
  seleccionVisible,
} from '../lib/filtro-familia'
import { limpiarNombreEmbebido } from '../lib/limpiar-nombre-embebido'
import { agruparLineasPanel, esConfirmado, type FilaFamiliaPanel } from '../lib/panel-familia'
import { componerResumenRecalculo } from '../lib/resumen-recalculo'
import type { NinoCargo } from '../lib/cargo-puntual'
import type { PanelMesData } from '../queries/get-recibos-mes-panel'
import { CargoPuntualDialog, type ConceptoPuntual } from './CargoPuntualDialog'
import { EditarReciboDialog } from './EditarReciboDialog'

/** Logo del centro para la cabecera del recibo interno (getCentroLogo). */
export interface CentroLogoProp {
  url: string
  name: string
}

type MetodoPago = Database['public']['Enums']['metodo_pago']
const METODOS: MetodoPago[] = ['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']
/** Valor del selector de familia para «todas» (un uuid nunca se llama así). */
const TODAS = 'todas'

interface Props {
  centroId: string
  anio: number
  mes: number
  data: PanelMesData
  /** Los niños con matrícula activa, con su clase (el cargo puntual los agrupa por ella). */
  ninos: NinoCargo[]
  /** PR-13: los conceptos esporádicos del catálogo, para el cargo puntual a varios niños. */
  conceptosPuntuales: ConceptoPuntual[]
  /** Logo del centro (getCentroLogo); null si no tiene → el recibo interno va sin logo. */
  centroLogo: CentroLogoProp | null
}

export function PanelMesRecibos({
  centroId,
  anio,
  mes,
  data,
  ninos,
  conceptosPuntuales,
  centroLogo,
}: Props) {
  const t = useTranslations('recibos_panel')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [generarOpen, setGenerarOpen] = useState(false)
  const [recalcularOpen, setRecalcularOpen] = useState(false)
  // PR-3: recibos que el último lote se saltó por su desborde de beca pendiente.
  const [saltados, setSaltados] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // F-6: filtro por familia (?familia=, que enlaza la ficha de la familia). Solo cambia lo que se
  // ve: generar y recalcular siguen contando el mes entero, y en lote solo se confirma lo marcado
  // que se ve (filtro-familia).
  const familiaFiltro = searchParams.get('familia')
  const opciones = opcionesFamilia(data.filas, data.esporadicos)
  const filtroConocido =
    familiaFiltro != null && opciones.some((o) => o.familiaId === familiaFiltro)
  const visible = filtrarPanel(data.filas, data.esporadicos, familiaFiltro)
  const idsVisibles = borradoresVisibles(visible.filas)
  const marcados = seleccionVisible(selected, idsVisibles)
  const opcionItems = [
    { value: TODAS, label: t('filtro_todas') },
    ...opciones.map((o) => ({ value: o.familiaId, label: o.etiqueta })),
  ]

  const borradores = data.filas.filter((f) => f.recibo && f.recibo.estado === 'borrador')
  const numBorradores = borradores.length
  const numConfirmados = data.indicadores.confirmados
  const bloqueado = data.cerrado
  // Se listan mientras sigan con el desborde pendiente: al resolverlo, salen solos.
  const filasSaltadas = data.filas.filter(
    (f) => f.recibo && f.desborde && saltados.includes(f.recibo.id)
  )

  function lanzarGenerar() {
    if (numBorradores > 0) setGenerarOpen(true)
    else ejecutarGenerar()
  }
  function ejecutarGenerar() {
    startTransition(async () => {
      const r = await generarRecibosMes({ anio, mes }, centroId)
      setGenerarOpen(false)
      if (r.success) toast.success(t('generado_ok', { n: r.data.generados }))
      else toast.error(tErrors(r.error))
    })
  }

  // R-1: siembra los conceptos automáticos que falten y REGENERA los borradores del mes.
  // Pide la misma confirmación que "generar" porque comparte su parte destructiva.
  function lanzarRecalcular() {
    if (numBorradores > 0) setRecalcularOpen(true)
    else ejecutarRecalcular()
  }
  function ejecutarRecalcular() {
    startTransition(async () => {
      const r = await recalcularMes({ anio, mes }, centroId)
      setRecalcularOpen(false)
      if (r.success) {
        // Aviso con lo que de verdad pasó, frase a frase. Nunca un "0" a secas: cuando no
        // hay nada que sembrar, la primera frase lo dice en palabras.
        toast.success(t('recalculo_titulo'), {
          description: componerResumenRecalculo(r.data)
            .map((frase) => t(frase.clave, frase.valores))
            .join(' · '),
        })
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function confirmarUno(reciboId: string) {
    startTransition(async () => {
      const r = await confirmarRecibo(reciboId)
      if (r.success) toast.success(r.data.cerrado ? t('confirmado_cierre') : t('confirmado_ok'))
      else toast.error(tErrors(r.error))
    })
  }

  // R-5: "Modificar" = desconfirmar. Si era el único que quedaba por procesar, el mes estaba
  // cerrado y se reabre; se dice, porque cambia lo que la directora puede hacer en toda la
  // pantalla (vuelven a habilitarse recalcular, generar y el resto de edición del mes).
  function desconfirmarUno(reciboId: string) {
    startTransition(async () => {
      const r = await desconfirmarRecibo(reciboId)
      if (r.success) {
        toast.success(r.data.mesReabierto ? t('desconfirmado_reabre') : t('desconfirmado_ok'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function confirmarSeleccionados() {
    const ids = marcados
    startTransition(async () => {
      const r = await confirmarRecibos(ids)
      if (r.success) {
        if (r.data.confirmados > 0) toast.success(t('lote_ok', { n: r.data.confirmados }))
        if (r.data.conDesborde.length > 0) {
          toast.warning(t('lote_saltados', { n: r.data.conDesborde.length }))
        }
        setSaltados(r.data.conDesborde)
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
    setSelected(on ? new Set(idsVisibles) : new Set())
  }
  function cambiarFiltro(valor: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'mes')
    if (valor === TODAS) params.delete('familia')
    else params.set('familia', valor)
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
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
        <div className="flex flex-wrap items-center gap-3">
          <MesSelector anio={anio} mes={mes} tab="mes" />
          <Select
            items={opcionItems}
            value={filtroConocido ? familiaFiltro : TODAS}
            onValueChange={(v) => cambiarFiltro(v as string)}
          >
            <SelectTrigger size="sm" className="w-56" aria-label={t('filtro_familia')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcionItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <CargoPuntualDialog
            centroId={centroId}
            anio={anio}
            mes={mes}
            ninos={ninos}
            conceptos={conceptosPuntuales}
            bloqueado={bloqueado}
          />
          <ReciboEsporadicoDialog anio={anio} mes={mes} ninos={ninos} />
          <Button variant="outline" disabled={pending || bloqueado} onClick={lanzarRecalcular}>
            {t('recalcular')}
          </Button>
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
        <Indicador
          label={t('ind_total')}
          valor={formatEuros(data.indicadores.totalCentimos, locale)}
        />
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

      {/* V2-4: aviso de recibos con desborde de beca comedor pendiente de resolver. */}
      {data.indicadores.desbordesPendientes > 0 && (
        <Card className="border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-800">
          {t('desborde_aviso', { n: data.indicadores.desbordesPendientes })}
        </Card>
      )}

      {/* PR-3: lo que el lote no validó por su desborde, aparte y con su importe. */}
      {filasSaltadas.length > 0 && (
        <Card className="space-y-2 border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-800">
          <p className="font-medium">{t('lote_saltados', { n: filasSaltadas.length })}</p>
          <ul className="space-y-1">
            {filasSaltadas.map((f) => (
              <li key={f.familiaId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t('lote_saltado_fila', {
                    familia: f.etiqueta,
                    importe: formatEuros(f.desborde!.excesoCentimos, locale),
                  })}
                </span>
                <ResolverDesbordeDialog
                  reciboId={f.desborde!.reciboId}
                  anio={anio}
                  mes={mes}
                  cuotaCentimos={f.desborde!.cuotaCentimos}
                  becaCentimos={f.desborde!.becaCentimos}
                  excesoCentimos={f.desborde!.excesoCentimos}
                  avisoValidar
                  trigger={<Button size="sm">{t('resolver_beca')}</Button>}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Barra de confirmación en lote */}
      {marcados.length > 0 && (
        <Card className="flex items-center justify-between gap-3 p-3">
          <span className="text-sm">{t('seleccionados', { n: marcados.length })}</span>
          <Button size="sm" disabled={pending} onClick={confirmarSeleccionados}>
            {t('confirmar_seleccionados')}
          </Button>
        </Card>
      )}

      {data.filas.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">{t('sin_familias')}</Card>
      ) : visible.filas.length === 0 && visible.esporadicos.length === 0 ? (
        <Card className="text-muted-foreground flex flex-wrap items-center justify-center gap-3 p-8 text-sm">
          <span>{t('filtro_sin_resultados')}</span>
          <Button size="sm" variant="outline" onClick={() => cambiarFiltro(TODAS)}>
            {t('quitar_filtro')}
          </Button>
        </Card>
      ) : visible.filas.length === 0 ? null : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    {idsVisibles.length > 0 && !bloqueado && (
                      <Checkbox
                        aria-label={t('sel_todos')}
                        checked={marcados.length === idsVisibles.length}
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
                {visible.filas.map((fila) => (
                  <FilaFamilia
                    key={fila.familiaId}
                    fila={fila}
                    anio={anio}
                    mes={mes}
                    bloqueado={bloqueado}
                    pending={pending}
                    centroLogo={centroLogo}
                    metodoPref={data.metodoPreferencia[fila.familiaId] ?? null}
                    metodoFicha={data.metodoFicha[fila.familiaId] ?? null}
                    tieneMandato={data.familiasConMandato.includes(fila.familiaId)}
                    seleccionado={fila.recibo ? selected.has(fila.recibo.id) : false}
                    expandido={expanded.has(fila.familiaId)}
                    onToggleSel={toggleSel}
                    onToggleExpand={() => toggleExpand(fila.familiaId)}
                    onConfirmar={confirmarUno}
                    onDesconfirmar={desconfirmarUno}
                    onCambiarMetodo={cambiarMetodo}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Esporádicos del mes (read-only) */}
      {visible.esporadicos.length > 0 && (
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
                {visible.esporadicos.map((e) => (
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
                      {formatEuros(e.totalCentimos, locale)}
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

      {/* R-1: mismo aviso destructivo, más la parte de sembrar conceptos */}
      <Dialog open={recalcularOpen} onOpenChange={setRecalcularOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('recalcular_confirm_title')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('recalcular_confirm_desc', {
              borradores: numBorradores,
              confirmados: numConfirmados,
            })}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRecalcularOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button disabled={pending} onClick={ejecutarRecalcular}>
              {t('recalcular_confirmar')}
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
  anio,
  mes,
  bloqueado,
  pending,
  centroLogo,
  metodoPref,
  metodoFicha,
  tieneMandato,
  seleccionado,
  expandido,
  onToggleSel,
  onToggleExpand,
  onConfirmar,
  onDesconfirmar,
  onCambiarMetodo,
}: {
  fila: FilaFamiliaPanel
  anio: number
  mes: number
  bloqueado: boolean
  pending: boolean
  centroLogo: CentroLogoProp | null
  metodoPref: MetodoPago | null
  metodoFicha: MetodoPago | null
  tieneMandato: boolean
  seleccionado: boolean
  expandido: boolean
  onToggleSel: (reciboId: string, on: boolean) => void
  onToggleExpand: () => void
  onConfirmar: (reciboId: string) => void
  onDesconfirmar: (reciboId: string) => void
  onCambiarMetodo: (familiaId: string, metodo: MetodoPago) => void
}) {
  const t = useTranslations('recibos_panel')
  const locale = useLocale()
  const recibo = fila.recibo
  const esBorrador = recibo?.estado === 'borrador'
  const confirmado = recibo != null && esConfirmado(recibo.estado)
  // R-5: sobre un confirmado, ¿se puede levantar el candado o hay que explicar por qué no?
  const acceso = recibo ? accesoModificar(recibo.estado, recibo.enRemesa) : null
  // PR-7: el recibo lleva el método congelado al generar; sin recibo, la excepción del mes o, si
  // no la hay, el de la ficha (lo que cogerá al generar).
  const metodoActual = recibo?.metodo ?? metodoPref ?? metodoFicha ?? undefined
  const esExcepcion = metodoPref != null && metodoFicha != null && metodoPref !== metodoFicha
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
          {esExcepcion && metodoFicha && (
            <div className="text-muted-foreground mt-1 text-xs">
              {t('metodo_excepcion', { ficha: t(`metodos.${metodoFicha}`) })}
            </div>
          )}
          {metodoActual === 'sepa' && !tieneMandato && (
            <div className="text-warm-800 mt-1 text-xs">{t('metodo_sepa_sin_mandato')}</div>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {recibo ? formatEuros(recibo.cargosCentimos, locale) : '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {recibo && recibo.descuentosCentimos !== 0
            ? formatEuros(recibo.descuentosCentimos, locale)
            : '—'}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {recibo ? formatEuros(recibo.totalCentimos, locale) : '—'}
        </TableCell>
        <TableCell>
          {!recibo ? (
            <Badge variant="warning">{t('estado_sin_cargos')}</Badge>
          ) : confirmado ? (
            <Badge variant="success">{t('estado_confirmado')}</Badge>
          ) : (
            <Badge variant="warm">{t('estado_borrador')}</Badge>
          )}
          {fila.desborde && (
            <Badge variant="warning" className="ml-2">
              {t('desborde_badge')}
            </Badge>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-2">
            {fila.desborde && (
              <ResolverDesbordeDialog
                reciboId={fila.desborde.reciboId}
                anio={anio}
                mes={mes}
                cuotaCentimos={fila.desborde.cuotaCentimos}
                becaCentimos={fila.desborde.becaCentimos}
                excesoCentimos={fila.desborde.excesoCentimos}
                trigger={<Button size="sm">{t('resolver_beca')}</Button>}
              />
            )}
            {recibo && (
              <Button size="sm" variant="ghost" onClick={onToggleExpand}>
                {expandido ? t('ocultar') : t('ver')}
              </Button>
            )}
            {/* A1: la familia sin recibo (el motor descartó el suyo por quedar vacío) no
                tiene dónde colgar una línea. Aquí se crea la carcasa al escribir la primera,
                en vez de dejar recibos de 0 € por todo el panel. */}
            {!recibo && !bloqueado && (
              <EditarReciboDialog
                destino={{ tipo: 'familia', familiaId: fila.familiaId, anio, mes }}
                lineas={[]}
                hijos={fila.hijos}
              />
            )}
            {esBorrador && !bloqueado && (
              <>
                <EditarReciboDialog
                  destino={{ tipo: 'recibo', reciboId: recibo!.id }}
                  lineas={recibo!.lineas}
                  hijos={fila.hijos}
                />
                {/* PR-3: con el desborde pendiente no se valida. «Confirmar» abre el aviso con el
                    importe y las dos salidas; resuelto, ya se confirma. */}
                {fila.desborde ? (
                  <ResolverDesbordeDialog
                    reciboId={fila.desborde.reciboId}
                    anio={anio}
                    mes={mes}
                    cuotaCentimos={fila.desborde.cuotaCentimos}
                    becaCentimos={fila.desborde.becaCentimos}
                    excesoCentimos={fila.desborde.excesoCentimos}
                    avisoValidar
                    trigger={
                      <Button size="sm" disabled={pending}>
                        {t('confirmar')}
                      </Button>
                    }
                  />
                ) : (
                  <Button size="sm" disabled={pending} onClick={() => onConfirmar(recibo!.id)}>
                    {t('confirmar')}
                  </Button>
                )}
              </>
            )}
            {/* R-5: el candado sigue significando lo mismo (este recibo NO se edita en
                caliente); "Modificar" es la única llave, y se ve. Si el recibo ya está en
                una remesa o el cobro avanzó, el botón se queda ahí pero deshabilitado y
                diciendo por qué: es más útil que desaparecer sin explicación. Nota: NO
                depende de `bloqueado` — confirmar el último recibo CIERRA el mes, así que
                exigir mes abierto para modificar haría el botón inalcanzable justo cuando
                hace falta (desconfirmar es, de hecho, lo que reabre el mes). */}
            {confirmado && (
              <>
                {acceso!.permitido ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onDesconfirmar(recibo!.id)}
                  >
                    {t('modificar')}
                  </Button>
                ) : (
                  <span title={t(`modificar_bloqueado.${acceso!.motivo}`)}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      aria-label={t(`modificar_bloqueado.${acceso!.motivo}`)}
                    >
                      {t('modificar')}
                    </Button>
                  </span>
                )}
                <span className="text-muted-foreground text-xs">🔒</span>
              </>
            )}
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
  const locale = useLocale()
  const primerNombre = grupo.ninoNombre?.split(' ')[0] ?? null
  return (
    <>
      <div className="col-span-4 pt-1 font-medium">{grupo.ninoNombre ?? t('familiar')}</div>
      {grupo.lineas.map((l) => (
        <Fragment key={l.id}>
          <span className="pl-3">{limpiarNombreEmbebido(l.descripcion, primerNombre)}</span>
          <span className="text-right tabular-nums">{l.cantidad}</span>
          <span className="text-right tabular-nums">
            {formatEuros(l.precioUnitarioCentimos, locale)}
          </span>
          <span className="text-right font-medium tabular-nums">
            {formatEuros(l.importeCentimos, locale)}
          </span>
        </Fragment>
      ))}
    </>
  )
}
