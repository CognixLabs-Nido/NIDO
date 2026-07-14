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
import { asignarConcepto } from '../actions/asignar-concepto'
import { desasignarConcepto } from '../actions/desasignar-concepto'
import type { ConceptoAsignable } from '../queries/get-conceptos-asignables'

// F-4-2: asignación PERMANENTE de conceptos por niño (sin mes, sin modalidad — la
// periodicidad es del concepto). MVP viable; la UX completa del panel es F-4-4.
type EstadoAsignacion = 'no_asignado' | 'asignado'

interface Props {
  centroId: string
  ninoId: string
  ninoNombre: string
  conceptos: ConceptoAsignable[]
  conceptosAsignados: string[]
}

export function ConfigurarModalidadDialog({
  centroId,
  ninoId,
  ninoNombre,
  conceptos,
  conceptosAsignados,
}: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  // Estado local para reflejar el cambio sin cerrar el diálogo.
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
          ? await asignarConcepto(centroId, ninoId, conceptoId)
          : await desasignarConcepto(centroId, ninoId, conceptoId)
      if (!r.success) {
        setValores((v) => ({ ...v, [conceptoId]: previo })) // revertir
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
          <DialogTitle>{t('asignar_title', { nombre: ninoNombre })}</DialogTitle>
        </DialogHeader>
        {conceptos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_conceptos_manuales')}</p>
        ) : (
          <ul className="space-y-2" aria-busy={pending}>
            {conceptos.map((c) => {
              const items = opciones.map((o) => ({
                value: o,
                label: t(`estado_asignacion.${o}`),
              }))
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
