'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { eurosACentimos, formatEuros } from '@/shared/lib/format-money'

import { anadirLineaRecibo, borrarLineaRecibo, editarLineaRecibo } from '../actions/lineas-recibo'
import type { LineaPanel } from '../lib/panel-familia'

interface Props {
  reciboId: string
  lineas: LineaPanel[]
  hijos: Array<{ ninoId: string; nombre: string }>
}

// F-4-4: edición de líneas de un recibo en BORRADOR (override puntual del mes). Avisa de
// que las ediciones se pierden si se regenera. Solo se ofrece en borradores.
export function EditarReciboDialog({ reciboId, lineas, hijos }: Props) {
  const t = useTranslations('recibos_panel')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Formulario de nueva línea.
  const [desc, setDesc] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [importe, setImporte] = useState('')
  const [ninoId, setNinoId] = useState<string>('')

  function feedback(r: { success: boolean; error?: string }, okMsg: string) {
    if (r.success) toast.success(t(okMsg))
    else toast.error(tErrors(r.error!))
  }

  function anadir() {
    const cant = Number(cantidad)
    const euros = Number(importe.replace(',', '.'))
    if (!desc.trim() || !Number.isInteger(cant) || cant < 1 || Number.isNaN(euros)) {
      toast.error(t('errors.linea_invalida'))
      return
    }
    startTransition(async () => {
      const r = await anadirLineaRecibo({
        reciboId,
        descripcion: desc.trim(),
        cantidad: cant,
        precioUnitarioCentimos: eurosACentimos(euros),
        ninoId: ninoId || null,
      })
      feedback(r, 'linea_anadida')
      if (r.success) {
        setDesc('')
        setCantidad('1')
        setImporte('')
        setNinoId('')
      }
    })
  }

  function borrar(lineaId: string) {
    startTransition(async () => {
      const r = await borrarLineaRecibo({ lineaId })
      feedback(r, 'linea_borrada')
    })
  }

  const ninoItems = [
    { value: '', label: t('linea_familiar') },
    ...hijos.map((h) => ({ value: h.ninoId, label: h.nombre })),
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            {t('editar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('editar_title')}</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-xs">{t('editar_aviso')}</p>

        <div className="space-y-2">
          {lineas.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('sin_lineas')}</p>
          )}
          {lineas.map((l) => (
            <LineaEditable key={l.id} linea={l} disabled={pending} onBorrar={() => borrar(l.id)} />
          ))}
        </div>

        <div className="border-border space-y-2 border-t pt-3">
          <p className="text-sm font-medium">{t('anadir_linea')}</p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('fields.descripcion')}
              maxLength={200}
              aria-label={t('fields.descripcion')}
            />
            <Input
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              inputMode="numeric"
              className="w-20"
              aria-label={t('fields.cantidad')}
            />
            <Input
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              inputMode="decimal"
              placeholder={t('fields.importe')}
              className="w-28"
              aria-label={t('fields.importe')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select items={ninoItems} value={ninoId} onValueChange={(v) => setNinoId(v ?? '')}>
              <SelectTrigger size="sm" className="w-56" aria-label={t('fields.atribuir')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ninoItems.map((item) => (
                  <SelectItem key={item.value || 'fam'} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={pending} onClick={anadir}>
              {t('anadir')}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('cerrar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LineaEditable({
  linea,
  disabled,
  onBorrar,
}: {
  linea: LineaPanel
  disabled: boolean
  onBorrar: () => void
}) {
  const t = useTranslations('recibos_panel')
  const tErrors = useTranslations()
  const [editando, setEditando] = useState(false)
  const [desc, setDesc] = useState(linea.descripcion)
  const [cantidad, setCantidad] = useState(String(linea.cantidad))
  const [importe, setImporte] = useState(
    String(linea.precioUnitarioCentimos / 100).replace('.', ',')
  )
  const [pending, startTransition] = useTransition()

  function guardar() {
    const cant = Number(cantidad)
    const euros = Number(importe.replace(',', '.'))
    if (!desc.trim() || !Number.isInteger(cant) || cant < 1 || Number.isNaN(euros)) {
      toast.error(t('errors.linea_invalida'))
      return
    }
    startTransition(async () => {
      const r = await editarLineaRecibo({
        lineaId: linea.id,
        descripcion: desc.trim(),
        cantidad: cant,
        precioUnitarioCentimos: eurosACentimos(euros),
      })
      if (r.success) {
        toast.success(t('linea_editada'))
        setEditando(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  if (editando) {
    return (
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
        <Input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="w-16"
          inputMode="numeric"
        />
        <Input
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          className="w-24"
          inputMode="decimal"
        />
        <Button size="sm" disabled={pending} onClick={guardar}>
          {t('guardar')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex-1 truncate">
        {linea.ninoNombre ? `${linea.ninoNombre} · ` : ''}
        {linea.descripcion}
        {linea.cantidad > 1 ? ` (×${linea.cantidad})` : ''}
      </span>
      <span className="tabular-nums">{formatEuros(linea.importeCentimos)}</span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditando(true)}>
        {t('editar')}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onBorrar}>
        {t('quitar')}
      </Button>
    </div>
  )
}
