'use client'

import { useState, useTransition } from 'react'

import { CalendarPlusIcon, MountainIcon } from 'lucide-react'
import Link from 'next/link'
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
 * Diálogo admin/profe: «Excursión» — crea una autorización de salida colgando de
 * un EVENTO de excursión (no es un formato de catálogo). Si no hay excursiones,
 * lleva a crearla primero en el calendario; si las hay, se elige una. Nace como
 * borrador con texto `PENDIENTE` — luego se teclea el texto y se publica.
 */
export function CrearAutorizacionDialog({
  eventos,
  locale,
}: {
  eventos: EventoExcursionOption[]
  locale: string
}) {
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

  const sinEventos = eventos.length === 0
  const calendarioHref = `/${locale}/admin/calendario`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <MountainIcon className="mr-1 size-4" />
            {t('excursion.accion')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('excursion.accion')}</DialogTitle>
        </DialogHeader>

        {sinEventos ? (
          // Sin excursiones: se crea primero el EVENTO en el calendario (no es un
          // formato de catálogo). Llevamos allí.
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">{t('excursion.sin_eventos')}</p>
            <Link href={calendarioHref} onClick={() => setOpen(false)}>
              <Button>
                <CalendarPlusIcon className="mr-1 size-4" />
                {t('excursion.crear_evento')}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">{t('excursion.intro')}</p>
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
                <Link
                  href={calendarioHref}
                  onClick={() => setOpen(false)}
                  className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 text-xs"
                >
                  <CalendarPlusIcon className="size-3.5" />
                  {t('excursion.crear_otra')}
                </Link>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
