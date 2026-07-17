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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { asignarConceptoFamilia } from '../actions/asignar-concepto-familia'
import { desasignarConceptoFamilia } from '../actions/desasignar-concepto-familia'
import type { ConceptoAsignablePermanente } from '../queries/get-asignacion-permanente'

// F-4-4: asignación PERMANENTE de conceptos de ámbito FAMILIA (descuento hermanos, cargos
// familiares). Espejo por-familia de ConfigurarModalidadDialog. Sin mes, sin método.
type EstadoAsignacion = 'no_asignado' | 'asignado'

interface Props {
  centroId: string
  familiaId: string
  familiaEtiqueta: string
  conceptos: ConceptoAsignablePermanente[]
  conceptosAsignados: string[]
}

export function FamiliaConceptosDialog({
  centroId,
  familiaId,
  familiaEtiqueta,
  conceptos,
  conceptosAsignados,
}: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [valores, setValores] = useState<Record<string, EstadoAsignacion>>(() =>
    Object.fromEntries(
      conceptos.map((c) => [c.id, conceptosAsignados.includes(c.id) ? 'asignado' : 'no_asignado'])
    )
  )

  const opciones: EstadoAsignacion[] = ['no_asignado', 'asignado']

  function cambiar(conceptoId: string, estado: EstadoAsignacion) {
    const previo = valores[conceptoId] ?? 'no_asignado'
    setValores((v) => ({ ...v, [conceptoId]: estado }))
    startTransition(async () => {
      const r =
        estado === 'asignado'
          ? await asignarConceptoFamilia(centroId, familiaId, conceptoId)
          : await desasignarConceptoFamilia(centroId, familiaId, conceptoId)
      if (!r.success) {
        setValores((v) => ({ ...v, [conceptoId]: previo }))
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t('configurar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('familia_conceptos_title', { nombre: familiaEtiqueta })}</DialogTitle>
        </DialogHeader>
        {conceptos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_conceptos_familia')}</p>
        ) : (
          <ul className="space-y-2" aria-busy={pending}>
            {conceptos.map((c) => {
              const items = opciones.map((o) => ({ value: o, label: t(`estado_asignacion.${o}`) }))
              return (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{c.nombre}</span>
                  <Select
                    items={items}
                    value={valores[c.id] ?? 'no_asignado'}
                    onValueChange={(v) => cambiar(c.id, v as EstadoAsignacion)}
                  >
                    <SelectTrigger size="sm" className="w-36" aria-label={t('fields.conceptos')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex justify-end pt-2">
          <Button type="button" onClick={() => setOpen(false)}>
            {t('cerrar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
