'use client'

import { useState, useTransition } from 'react'

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

import { crearAutorizacionSalida } from '../actions/gestionar-autorizacion'
import type { EventoExcursionOption } from '../queries/get-eventos-excursion'

/**
 * Diálogo admin/profe: crea una autorización de salida colgando de un evento de
 * excursión. Nace como borrador con texto `PENDIENTE` — luego se teclea el texto
 * y se publica.
 */
export function CrearAutorizacionDialog({ eventos }: { eventos: EventoExcursionOption[] }) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [eventoId, setEventoId] = useState<string>('')
  const [titulo, setTitulo] = useState('')
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    if (!eventoId || titulo.trim().length === 0) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    startTransition(async () => {
      const res = await crearAutorizacionSalida({ evento_id: eventoId, titulo: titulo.trim() })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.creada_toast'))
      setOpen(false)
      setTitulo('')
      setEventoId('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button disabled={eventos.length === 0}>
            <PlusIcon className="mr-1 size-4" />
            {t('acciones.nueva')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('acciones.nueva')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('form.evento')}</Label>
            <Select value={eventoId} onValueChange={(v) => setEventoId(v ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder={t('form.evento_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {eventos.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.titulo} · {e.fecha}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="titulo-autorizacion">{t('form.titulo')}</Label>
            <Input
              id="titulo-autorizacion"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder={t('form.titulo_placeholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('acciones.creando') : t('acciones.crear')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
