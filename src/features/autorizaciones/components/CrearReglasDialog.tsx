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

import { crearAutorizacionPorNino } from '../actions/gestionar-autorizacion'

interface NinoOption {
  id: string
  nombre: string
  apellidos: string
}

/**
 * Diálogo admin: crea una autorización de **reglas de régimen interno** para un
 * niño. Reusa el flujo de F8-1 (luego se teclea el texto y se publica). El
 * documento es "firmar este texto por niño" — sin campos estructurados extra.
 */
export function CrearReglasDialog({ ninos }: { ninos: NinoOption[] }) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ninoId, setNinoId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    if (!ninoId || titulo.trim().length === 0) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    startTransition(async () => {
      const res = await crearAutorizacionPorNino({
        tipo: 'reglas_regimen_interno',
        nino_id: ninoId,
        titulo: titulo.trim(),
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.creada_toast'))
      setOpen(false)
      setTitulo('')
      setNinoId('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" disabled={ninos.length === 0}>
            <PlusIcon className="mr-1 size-4" />
            {t('acciones.nueva_reglas')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('acciones.nueva_reglas')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('form.nino')}</Label>
            <Select value={ninoId} onValueChange={(v) => setNinoId(v ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder={t('form.nino_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {ninos.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.nombre} {n.apellidos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="titulo-reglas">{t('form.titulo')}</Label>
            <Input
              id="titulo-reglas"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder={t('form.titulo_reglas_placeholder')}
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
