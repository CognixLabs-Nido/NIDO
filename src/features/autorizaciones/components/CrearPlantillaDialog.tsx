'use client'

import { useMemo, useState, useTransition } from 'react'

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

import { crearPlantilla } from '../actions/gestionar-autorizacion'
import { tipoPlantillaEnum, type TipoPlantilla } from '../schemas/autorizaciones'

/**
 * Diálogo admin: crea una **plantilla durable** del catálogo (el formato estándar
 * del centro) para un tipo por-niño (reglas/imágenes/recogida/medicación). Tras
 * crearla, el admin teclea el texto, lo marca definitivo y la publica desde su
 * detalle. La plantilla NO se firma: las tipo A se envían a una audiencia; las
 * tipo B (recogida/medicación) las inicia la familia.
 */
export function CrearPlantillaDialog() {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<TipoPlantilla | ''>('')
  const [titulo, setTitulo] = useState('')
  const [pending, startTransition] = useTransition()

  const tipoItems = useMemo(
    () => tipoPlantillaEnum.options.map((v) => ({ value: v, label: t(`tipo.${v}`) })),
    [t]
  )

  function onSubmit() {
    if (!tipo || titulo.trim().length === 0) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    startTransition(async () => {
      const res = await crearPlantilla({ tipo, titulo: titulo.trim() })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.plantilla_creada_toast'))
      setOpen(false)
      setTitulo('')
      setTipo('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <PlusIcon className="mr-1 size-4" />
            {t('catalogo.nuevo_formato')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('catalogo.nuevo_formato')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t('catalogo.intro')}</p>
          <div className="space-y-2">
            <Label>{t('form.tipo')}</Label>
            <Select
              items={tipoItems}
              value={tipo}
              onValueChange={(v) => setTipo((v ?? '') as TipoPlantilla | '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('form.tipo_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {tipoItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="titulo-plantilla">{t('form.titulo')}</Label>
            <Input
              id="titulo-plantilla"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder={t('form.titulo_plantilla_placeholder')}
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
