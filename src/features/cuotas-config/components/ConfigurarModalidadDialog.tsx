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
import { setModalidad } from '../actions/set-modalidad'
import type { ConceptoAsignable } from '../queries/get-conceptos-asignables'

type ModalidadOpcion = 'ninguna' | 'mensual' | 'diario'

interface Props {
  centroId: string
  ninoId: string
  ninoNombre: string
  anio: number
  mes: number
  conceptos: ConceptoAsignable[]
  modalidades: Record<string, 'mensual' | 'diario'>
}

export function ConfigurarModalidadDialog({
  centroId,
  ninoId,
  ninoNombre,
  anio,
  mes,
  conceptos,
  modalidades,
}: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  // Estado local para reflejar el cambio sin cerrar el diálogo.
  const [valores, setValores] = useState<Record<string, ModalidadOpcion>>(() =>
    Object.fromEntries(conceptos.map((c) => [c.id, modalidades[c.id] ?? 'ninguna']))
  )

  const opciones: ModalidadOpcion[] = ['ninguna', 'mensual', 'diario']

  function cambiar(conceptoId: string, modalidad: ModalidadOpcion) {
    const previo = valores[conceptoId] ?? 'ninguna'
    setValores((v) => ({ ...v, [conceptoId]: modalidad }))
    startTransition(async () => {
      const r = await setModalidad(centroId, ninoId, conceptoId, anio, mes, modalidad)
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
          <DialogTitle>{t('modalidad_title', { nombre: ninoNombre })}</DialogTitle>
        </DialogHeader>
        {conceptos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_conceptos_asignables')}</p>
        ) : (
          <ul className="space-y-2" aria-busy={pending}>
            {conceptos.map((c) => {
              const items = opciones.map((o) => ({ value: o, label: t(`modalidades.${o}`) }))
              return (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{c.nombre}</span>
                  <Select
                    items={items}
                    value={valores[c.id] ?? 'ninguna'}
                    onValueChange={(v) => cambiar(c.id, v as ModalidadOpcion)}
                  >
                    <SelectTrigger size="sm" className="w-36" aria-label={t('fields.modalidad')}>
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
