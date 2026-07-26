'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { centimosAEuros } from '@/shared/lib/format-money'

import { crearCarga, editarCarga } from '../actions/cargas-beca'
import { etiquetaMes, mesKey } from '../lib/meses'
import type { CargaBecaItem } from '../queries/get-cargas-beca'
import type { MesCurso } from '../lib/cargas'

interface Props {
  meses: MesCurso[]
  mesesCerrados: MesCurso[]
  /** Presente = modo EDITAR (mes correspondiente fijo); ausente = CREAR. */
  carga?: CargaBecaItem
  trigger: ReactElement
}

export function CargaFormDialog({ meses, mesesCerrados, carga, trigger }: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const tRoot = useTranslations()
  const locale = useLocale()
  const editar = carga != null

  const [open, setOpen] = useState(false)
  const [mesCorr, setMesCorr] = useState(
    carga ? mesKey(carga.anioCorrespondiente, carga.mesCorrespondiente) : ''
  )
  const [mesAplic, setMesAplic] = useState(
    carga ? mesKey(carga.anioAplicacion, carga.mesAplicacion) : ''
  )
  const [importe, setImporte] = useState(carga ? String(centimosAEuros(carga.importeCentimos)) : '')
  const [pending, startTransition] = useTransition()

  const cerrado = (k: string) => mesesCerrados.some((m) => mesKey(m.anio, m.mes) === k)

  function parseKey(k: string): { anio: number; mes: number } | null {
    const [a, m] = k.split('-').map(Number)
    return a && m ? { anio: a, mes: m } : null
  }

  function onSubmit() {
    const corr = parseKey(mesCorr)
    const aplic = parseKey(mesAplic)
    if (!corr || !aplic) {
      toast.error(t('validation.meses_requeridos'))
      return
    }
    const input = {
      anio_correspondiente: corr.anio,
      mes_correspondiente: corr.mes,
      anio_aplicacion: aplic.anio,
      mes_aplicacion: aplic.mes,
      importe_euros: importe === '' ? NaN : Number(importe),
    }
    startTransition(async () => {
      const r = editar ? await editarCarga(input) : await crearCarga(input)
      if (r.success) {
        toast.success(editar ? t('carga_editada') : t('carga_creada', { n: r.data.n }))
        setOpen(false)
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editar ? t('editar_title') : t('nueva_title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('mes_correspondiente')}</Label>
            <Select value={mesCorr} onValueChange={(v) => setMesCorr(v ?? '')} disabled={editar}>
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
            <Select value={mesAplic} onValueChange={(v) => setMesAplic(v ?? '')}>
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
            <p className="text-muted-foreground text-xs">{t('mes_aplicacion_hint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="importe-beca">{t('importe_label')}</Label>
            <Input
              id="importe-beca"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              className="w-40"
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
            />
          </div>
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
