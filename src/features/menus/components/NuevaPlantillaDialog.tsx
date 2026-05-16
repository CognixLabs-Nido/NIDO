'use client'

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
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

import { crearPlantillaMensual } from '../actions/crear-plantilla-mensual'

interface Props {
  centroId: string
  locale: 'es' | 'en' | 'va'
}

function nombreMes(mes: number, locale: 'es' | 'en' | 'va'): string {
  const intlTag = locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES'
  return new Intl.DateTimeFormat(intlTag, { month: 'long' }).format(new Date(2026, mes - 1, 1))
}

export function NuevaPlantillaDialog({ centroId, locale }: Props) {
  const t = useTranslations('menus')
  const tToast = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const hoy = new Date()
  const [mes, setMes] = useState(String(hoy.getMonth() + 1))
  const [anio, setAnio] = useState(String(hoy.getFullYear()))

  function crear() {
    const mesNum = Number(mes)
    const anioNum = Number(anio)
    if (mesNum < 1 || mesNum > 12 || anioNum < 2024 || anioNum > 2100) {
      toast.error(tToast('menus.toasts.error_guardar'))
      return
    }
    startTransition(async () => {
      const r = await crearPlantillaMensual({ centro_id: centroId, mes: mesNum, anio: anioNum })
      if (r.success) {
        toast.success(t('toasts.plantilla_creada'))
        setOpen(false)
        router.push(`/${locale}/admin/menus/${r.data.id}`)
      } else {
        toast.error(tToast(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button data-testid="abrir-nueva-plantilla">
            <PlusIcon className="size-4" />
            {t('lista.nueva')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('lista.nueva_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="mes-input">
                {t('lista.mes_label')}
              </label>
              <Select value={mes} onValueChange={(v) => v && setMes(v)}>
                <SelectTrigger id="mes-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {nombreMes(m, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-sm font-medium" htmlFor="anio-input">
                {t('lista.anio_label')}
              </label>
              <Input
                id="anio-input"
                type="number"
                min={2024}
                max={2100}
                value={anio}
                onChange={(e) => setAnio(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lista.cancelar')}
            </Button>
            <Button type="button" onClick={crear} disabled={pending} data-testid="crear-plantilla">
              {t('lista.crear')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
