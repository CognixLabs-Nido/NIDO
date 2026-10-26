'use client'

import { type ReactElement, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FiltroClaseYNombre } from '@/shared/components/FiltroClaseYNombre'
import { clasesDe, filtrarNinos } from '@/shared/lib/filtrar-ninos'
import { centimosAEuros } from '@/shared/lib/format-money'

import { crearCarga, editarCarga } from '../actions/cargas-beca'
import { alternarAnio, aniosDe } from '../lib/alumno-beca'
import { cargaAnterior, type CargaAgrupada, type MesCurso } from '../lib/cargas'
import { etiquetaMes, mesKey } from '../lib/meses'
import type { CargaBecaItem } from '../queries/get-cargas-beca'

export interface AlumnoBecado {
  id: string
  nombre: string
  aula: string | null
  anioNacimiento: number | null
}

interface Props {
  /** Centro activo de la página: el de la carga. */
  centroId: string
  meses: MesCurso[]
  mesesCerrados: MesCurso[]
  /** Alumnos con la beca activa en el curso. */
  becados: AlumnoBecado[]
  /** Nombre de los alumnos con tramo que ya no tienen la beca activa. */
  nombres: Record<string, string>
  /** `"{ninoId}:{anio}-{mes}"` con el recibo regular de ese mes ya validado. */
  recibosValidados: string[]
  /** Todas las cargas del curso: la nueva se rellena con la anterior. */
  cargas: CargaAgrupada[]
  /** Presente = modo EDITAR (mes correspondiente fijo); ausente = CREAR. */
  carga?: CargaBecaItem
  trigger: ReactElement
}

interface Fila {
  id: string
  nombre: string
  /** La clase y el año de nacimiento; null en quien ya no tiene la beca. */
  aula: string | null
  anioNacimiento: number | null
  becado: boolean
  /** Ya descontado en un recibo validado: no se toca. */
  aplicado: boolean
}

function aTexto(centimos: number | undefined): string {
  return centimos == null ? '' : String(centimosAEuros(centimos))
}

function parseKey(k: string): { anio: number; mes: number } | null {
  const [a, m] = k.split('-').map(Number)
  return a && m ? { anio: a, mes: m } : null
}

/**
 * V2-3 / PR-10 — crear o editar una carga de beca comedor: el importe de CADA becado (varía con
 * los ingresos de la familia), con selección múltiple para poner el mismo a varios de golpe, y
 * selección por edad (año de nacimiento). La lista se filtra por clase y por nombre. La carga
 * nueva viene rellena con los importes de la anterior. Al editar salen también los becados que no
 * estaban en la carga (marcados después), para ponerles su importe.
 */
export function CargaFormDialog({
  centroId,
  meses,
  mesesCerrados,
  becados,
  nombres,
  recibosValidados,
  cargas,
  carga,
  trigger,
}: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const tRoot = useTranslations()
  const locale = useLocale()
  const editar = carga != null

  const filas: Fila[] = useMemo(() => {
    const deBeca = new Set(becados.map((b) => b.id))
    const out: Fila[] = becados.map((b) => ({
      id: b.id,
      nombre: b.nombre,
      aula: b.aula,
      anioNacimiento: b.anioNacimiento,
      becado: true,
      aplicado: carga?.importes[b.id]?.aplicado ?? false,
    }))
    for (const [id, imp] of Object.entries(carga?.importes ?? {})) {
      if (deBeca.has(id)) continue
      out.push({
        id,
        nombre: nombres[id] ?? '—',
        aula: null,
        anioNacimiento: null,
        becado: false,
        aplicado: imp.aplicado,
      })
    }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [becados, nombres, carga])

  const inicial = () =>
    Object.fromEntries(filas.map((f) => [f.id, aTexto(carga?.importes[f.id]?.centimos)]))

  const [open, setOpen] = useState(false)
  const [mesCorr, setMesCorr] = useState(
    carga ? mesKey(carga.anioCorrespondiente, carga.mesCorrespondiente) : ''
  )
  const [mesAplic, setMesAplic] = useState(
    carga ? mesKey(carga.anioAplicacion, carga.mesAplicacion) : ''
  )
  const [importes, setImportes] = useState<Record<string, string>>(inicial)
  const [anterior, setAnterior] = useState<CargaAgrupada | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [importeLote, setImporteLote] = useState('')
  const [aula, setAula] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [pending, startTransition] = useTransition()

  const cerrado = (k: string) => mesesCerrados.some((m) => mesKey(m.anio, m.mes) === k)
  const validados = useMemo(() => new Set(recibosValidados), [recibosValidados])
  const aplic = parseKey(mesAplic)
  const editables = filas.filter((f) => !f.aplicado)
  const clases = useMemo(() => clasesDe(filas), [filas])
  const anios = useMemo(() => aniosDe(editables), [editables])
  const visibles = filtrarNinos(filas, aula, texto)
  const editablesVisibles = visibles.filter((f) => !f.aplicado)
  const mesFijo = editar && carga.nAplicados > 0

  function onOpenChange(next: boolean) {
    if (next) {
      // Cada vez que se abre, parte de lo guardado.
      setImportes(inicial())
      setSeleccion(new Set())
      setImporteLote('')
      setAula(null)
      setTexto('')
      if (!editar) {
        setMesCorr('')
        setMesAplic('')
        setAnterior(null)
      }
    }
    setOpen(next)
  }

  // CREAR: al elegir el mes correspondiente, los importes de la carga anterior.
  function onMesCorr(k: string) {
    setMesCorr(k)
    const corr = parseKey(k)
    const prev = corr ? cargaAnterior(cargas, corr.anio, corr.mes) : null
    setAnterior(prev)
    setImportes(
      Object.fromEntries(filas.map((f) => [f.id, aTexto(prev?.importes[f.id]?.centimos)]))
    )
  }

  function toggle(id: string, on: boolean) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function aplicarLote(valor: string) {
    setImportes((prev) => {
      const next = { ...prev }
      for (const id of seleccion) next[id] = valor
      return next
    })
  }

  function onSubmit() {
    const corr = parseKey(mesCorr)
    if (!corr || !aplic) {
      toast.error(t('validation.meses_requeridos'))
      return
    }
    const filasInput = []
    for (const f of editables) {
      const txt = (importes[f.id] ?? '').trim()
      if (txt === '') {
        filasInput.push({ nino_id: f.id, importe_euros: null })
        continue
      }
      const n = Number(txt.replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(t('validation.importe_invalido'))
        return
      }
      filasInput.push({ nino_id: f.id, importe_euros: n })
    }
    const input = {
      anio_correspondiente: corr.anio,
      mes_correspondiente: corr.mes,
      anio_aplicacion: aplic.anio,
      mes_aplicacion: aplic.mes,
      importes: filasInput,
    }
    startTransition(async () => {
      const r = editar ? await editarCarga(input, centroId) : await crearCarga(input, centroId)
      if (r.success) {
        toast.success(editar ? t('carga_editada') : t('carga_creada', { n: r.data.n }))
        setOpen(false)
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  const conImporte = filas.filter((f) => (importes[f.id] ?? '').trim() !== '').length
  const todos = editablesVisibles.length > 0 && editablesVisibles.every((f) => seleccion.has(f.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editar ? t('editar_title') : t('nueva_title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('mes_correspondiente')}</Label>
              <Select value={mesCorr} onValueChange={(v) => onMesCorr(v ?? '')} disabled={editar}>
                <SelectTrigger>
                  <SelectValue placeholder={t('mes_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {meses.map((m) => {
                    const k = mesKey(m.anio, m.mes)
                    return (
                      <SelectItem key={k} value={k}>
                        {etiquetaMes(locale, m.anio, m.mes)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t('mes_correspondiente_hint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t('mes_aplicacion')}</Label>
              <Select
                value={mesAplic}
                onValueChange={(v) => setMesAplic(v ?? '')}
                disabled={mesFijo}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('mes_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {meses.map((m) => {
                    const k = mesKey(m.anio, m.mes)
                    const isCerrado = cerrado(k)
                    return (
                      <SelectItem key={k} value={k} disabled={isCerrado}>
                        {etiquetaMes(locale, m.anio, m.mes)}
                        {isCerrado ? ` · ${t('cerrado')}` : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {mesFijo ? t('mes_aplicacion_fijo') : t('mes_aplicacion_hint')}
              </p>
            </div>
          </div>

          {!editar && mesCorr !== '' && (
            <p className="text-muted-foreground text-xs">
              {anterior
                ? t('relleno_de', {
                    mes: etiquetaMes(
                      locale,
                      anterior.anioCorrespondiente,
                      anterior.mesCorrespondiente
                    ),
                  })
                : t('sin_carga_anterior')}
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="importe-lote">{t('importe_seleccion')}</Label>
              <Input
                id="importe-lote"
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                className="w-32"
                value={importeLote}
                onChange={(e) => setImporteLote(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={seleccion.size === 0 || importeLote.trim() === ''}
              onClick={() => aplicarLote(importeLote.trim())}
            >
              {t('poner_seleccion', { n: seleccion.size })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={seleccion.size === 0}
              onClick={() => aplicarLote('')}
            >
              {t('quitar_seleccion')}
            </Button>
          </div>

          {anios.length > 0 && (
            <div
              role="group"
              aria-label={t('por_edad')}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-muted-foreground text-xs">{t('por_edad')}</span>
              {anios.map((a) => {
                const delAnio = editables.filter((f) => f.anioNacimiento === a)
                const marcado = delAnio.every((f) => seleccion.has(f.id))
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => setSeleccion((prev) => alternarAnio(prev, editables, a))}
                    className={[
                      'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                      marcado
                        ? 'border-primary-500 bg-primary-100 text-primary-800'
                        : 'border-border bg-card text-foreground hover:bg-muted',
                    ].join(' ')}
                  >
                    {t('nacidos_en', { anio: a, n: delAnio.length })}
                  </button>
                )
              })}
            </div>
          )}

          {filas.length > 0 && (
            <FiltroClaseYNombre
              clases={clases}
              aula={aula}
              onAula={setAula}
              texto={texto}
              onTexto={setTexto}
            />
          )}

          <div className="rounded-md border">
            <div className="flex items-center gap-3 border-b px-3 py-2 text-xs font-medium">
              <Checkbox
                checked={todos}
                disabled={editablesVisibles.length === 0}
                onCheckedChange={(v) =>
                  setSeleccion((prev) => {
                    const next = new Set(prev)
                    for (const f of editablesVisibles) {
                      if (v === true) next.add(f.id)
                      else next.delete(f.id)
                    }
                    return next
                  })
                }
                aria-label={t('seleccionar_todos')}
              />
              <span className="flex-1">{t('col_alumno')}</span>
              <span className="w-32 text-right">{t('importe_label')}</span>
            </div>
            {filas.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-xs">{t('sin_becados_hint')}</p>
            ) : (
              <ul className="divide-y">
                {visibles.map((f) => {
                  const valor = importes[f.id] ?? ''
                  const validado =
                    !f.aplicado &&
                    valor.trim() !== '' &&
                    aplic != null &&
                    validados.has(`${f.id}:${aplic.anio}-${aplic.mes}`)
                  return (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        checked={seleccion.has(f.id)}
                        disabled={f.aplicado}
                        onCheckedChange={(v) => toggle(f.id, v === true)}
                        aria-label={t('seleccionar', { nombre: f.nombre })}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="truncate">{f.nombre}</span>
                          {f.aula && (
                            <span className="text-muted-foreground text-xs">{f.aula}</span>
                          )}
                          {f.aplicado && <Badge variant="secondary">{t('fila_descontada')}</Badge>}
                          {!f.becado && <Badge variant="outline">{t('fila_sin_beca')}</Badge>}
                          {editar && f.becado && carga.importes[f.id] == null && (
                            <Badge variant="outline">{t('fila_nuevo')}</Badge>
                          )}
                        </div>
                        {validado && aplic && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {t('recibo_validado', {
                              mes: etiquetaMes(locale, aplic.anio, aplic.mes),
                            })}
                          </p>
                        )}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        className="w-32 text-right"
                        value={valor}
                        disabled={f.aplicado}
                        aria-label={t('importe_de', { nombre: f.nombre })}
                        onChange={(e) =>
                          setImportes((prev) => ({ ...prev, [f.id]: e.target.value }))
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            {filas.length > 0 && visibles.length === 0 && (
              <p className="text-muted-foreground px-3 py-2 text-xs">
                {tRoot('common.filtro_ninos.sin_resultados')}
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t('resumen_importes', { n: conImporte, total: filas.length })}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancelar')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={pending}>
            {editar ? t('guardar') : t('crear')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
