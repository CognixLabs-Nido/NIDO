'use client'

import { useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatEuros } from '@/shared/lib/format-money'
import { localeIntl } from '@/shared/lib/locale-intl'

import { anadirCargoPuntual } from '../actions/cargo-puntual'
import {
  agruparPorAula,
  alternarGrupo,
  importeCargo,
  marcaGrupo,
  resumirCargo,
  type NinoCargo,
  type ResumenCargo,
} from '../lib/cargo-puntual'

/** Un concepto esporádico del catálogo: rellena la descripción y el importe. */
export interface ConceptoPuntual {
  id: string
  nombre: string
  importeCentimos: number | null
}

interface Props {
  centroId: string
  anio: number
  mes: number
  ninos: NinoCargo[]
  conceptos: ConceptoPuntual[]
  /** El mes está cerrado: no admite cargos. */
  bloqueado: boolean
}

const TEXTO_LIBRE = 'texto_libre'

/**
 * PR-13: un cargo puntual (excursión y similares) a varios niños de golpe, por clase o a mano.
 * Cada niño recibe una línea manual en el recibo del mes de su familia. Al terminar se cuenta qué
 * pasó: a cuántos se añadió, a quién ya lo tenía y qué familias no se tocaron por tener el recibo
 * ya validado.
 */
export function CargoPuntualDialog({ centroId, anio, mes, ninos, conceptos, bloqueado }: Props) {
  const t = useTranslations('cargo_puntual')
  const tPanel = useTranslations('recibos_panel')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [conceptoId, setConceptoId] = useState(TEXTO_LIBRE)
  const [descripcion, setDescripcion] = useState('')
  const [importe, setImporte] = useState('')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [resumen, setResumen] = useState<ResumenCargo | null>(null)
  const [pending, startTransition] = useTransition()

  const grupos = useMemo(() => agruparPorAula(ninos), [ninos])
  const nombres = useMemo(() => new Map(ninos.map((n) => [n.id, n.nombre])), [ninos])
  const mesLabel = new Intl.DateTimeFormat(localeIntl(locale), {
    month: 'long',
    year: 'numeric',
  }).format(new Date(anio, mes - 1, 1))

  const previa = importeCargo(importe)

  const conceptoItems = [
    { value: TEXTO_LIBRE, label: t('texto_libre') },
    ...conceptos.map((c) => ({ value: c.id, label: c.nombre })),
  ]

  function reiniciar() {
    setConceptoId(TEXTO_LIBRE)
    setDescripcion('')
    setImporte('')
    setElegidos(new Set())
    setResumen(null)
  }

  function elegirConcepto(id: string) {
    setConceptoId(id)
    const c = conceptos.find((x) => x.id === id)
    if (!c) return
    setDescripcion(c.nombre)
    if (c.importeCentimos != null) setImporte(String(c.importeCentimos / 100).replace('.', ','))
  }

  function alternarNino(id: string, elegir: boolean) {
    setElegidos((prev) => {
      const next = new Set(prev)
      if (elegir) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function anadir() {
    const centimos = importeCargo(importe)
    const motivo = !descripcion.trim()
      ? 'cargo_puntual.errors.sin_descripcion'
      : centimos === null
        ? 'cargo_puntual.errors.importe_invalido'
        : elegidos.size === 0
          ? 'cargo_puntual.errors.sin_ninos'
          : null
    if (motivo || centimos === null) {
      toast.error(tErrors(motivo ?? 'cargo_puntual.errors.importe_invalido'))
      return
    }
    startTransition(async () => {
      const r = await anadirCargoPuntual({
        centroId,
        anio,
        mes,
        ninoIds: [...elegidos],
        descripcion: descripcion.trim(),
        importeCentimos: centimos,
        conceptoId: conceptoId === TEXTO_LIBRE ? null : conceptoId,
      })
      if (r.success) {
        const res = resumirCargo(r.data.filas, nombres)
        setResumen(res)
        toast.success(t('ok', { n: res.incluidos }))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reiniciar()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" disabled={bloqueado}>
            {t('abrir')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('titulo')}</DialogTitle>
          <DialogDescription>{t('ayuda', { mes: mesLabel })}</DialogDescription>
        </DialogHeader>

        {resumen ? (
          <div className="space-y-3 text-sm" data-testid="cargo-puntual-resumen">
            <p className="font-medium">
              {t('resumen_incluidos', { n: resumen.incluidos, familias: resumen.familias })}
            </p>
            {resumen.recibosNuevos > 0 && (
              <p className="text-muted-foreground">
                {t('resumen_recibos_nuevos', { n: resumen.recibosNuevos })}
              </p>
            )}
            {resumen.yaIncluidos.length > 0 && (
              <div>
                <p className="font-medium">
                  {t('resumen_ya_incluidos', { n: resumen.yaIncluidos.length })}
                </p>
                <p className="text-muted-foreground">{resumen.yaIncluidos.join(', ')}</p>
              </div>
            )}
            {resumen.noIncluidas.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-amber-800">
                <p className="font-medium">
                  {t('resumen_no_incluidas', { n: resumen.noIncluidas.length })}
                </p>
                <ul className="space-y-1">
                  {resumen.noIncluidas.map((f) => (
                    <li key={f.familia}>
                      {t('resumen_no_incluida_fila', {
                        familia: f.familia,
                        estado: tPanel(`estado_recibo.${f.estado}`),
                        ninos: f.ninos.join(', '),
                      })}
                    </li>
                  ))}
                </ul>
                <p>{t('resumen_no_incluidas_ayuda')}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={reiniciar}>
                {t('otro')}
              </Button>
              <Button onClick={() => setOpen(false)}>{tPanel('cerrar')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
              {conceptos.length > 0 && (
                <Select
                  items={conceptoItems}
                  value={conceptoId}
                  onValueChange={(v) => elegirConcepto(v ?? TEXTO_LIBRE)}
                >
                  <SelectTrigger className="sm:col-span-2" aria-label={t('concepto')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {conceptoItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                maxLength={200}
                placeholder={t('descripcion_placeholder')}
                aria-label={t('descripcion')}
              />
              <Input
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                inputMode="decimal"
                placeholder={tPanel('fields.importe')}
                aria-label={tPanel('fields.importe')}
              />
            </div>

            {grupos.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('sin_ninos_centro')}</p>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {grupos.map((g) => {
                  const marca = marcaGrupo(g, elegidos)
                  const nombreAula = g.aula ?? t('sin_clase')
                  return (
                    <div key={g.aula ?? ''} className="space-y-1">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={marca === 'todos'}
                          indeterminate={marca === 'algunos'}
                          onCheckedChange={(c) =>
                            setElegidos(alternarGrupo(g, elegidos, c === true))
                          }
                          aria-label={t('toda_la_clase', { clase: nombreAula })}
                        />
                        {nombreAula}
                        <span className="text-muted-foreground font-normal tabular-nums">
                          {g.ninos.filter((n) => elegidos.has(n.id)).length}/{g.ninos.length}
                        </span>
                      </label>
                      <div className="grid gap-1 pl-6 sm:grid-cols-2">
                        {g.ninos.map((n) => (
                          <label key={n.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={elegidos.has(n.id)}
                              onCheckedChange={(c) => alternarNino(n.id, c === true)}
                            />
                            {n.nombre}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-muted-foreground text-sm">
                {previa === null || elegidos.size === 0
                  ? t('elegidos', { n: elegidos.size })
                  : t('elegidos_total', {
                      n: elegidos.size,
                      total: formatEuros(previa * elegidos.size, locale),
                    })}
              </span>
              <Button disabled={pending || bloqueado} onClick={anadir}>
                {t('anadir')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
