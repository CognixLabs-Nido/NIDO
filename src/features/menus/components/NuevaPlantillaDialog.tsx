'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { crearPlantilla } from '../actions/crear-plantilla'

/**
 * Dialog para crear una plantilla nueva (solo cabecera). Al guardar
 * redirige al editor de la plantilla recién creada.
 */
export function NuevaPlantillaDialog() {
  const t = useTranslations('menus')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    nombre: '',
    vigente_desde: '',
    vigente_hasta: '',
  })

  function onSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await crearPlantilla({
        nombre: form.nombre.trim(),
        vigente_desde: form.vigente_desde === '' ? null : form.vigente_desde,
        vigente_hasta: form.vigente_hasta === '' ? null : form.vigente_hasta,
      })
      if (result.success) {
        setOpen(false)
        setForm({ nombre: '', vigente_desde: '', vigente_hasta: '' })
        // Redirige al editor de la nueva plantilla.
        router.push(window.location.pathname.replace(/\/menus$/, `/menus/${result.data.id}`))
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)} data-testid="nueva-plantilla">
        <PlusIcon className="size-4" />
        {t('nueva')}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nueva')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="nombre">{t('campos.nombre')}</Label>
            <Input
              id="nombre"
              value={form.nombre}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              data-testid="plantilla-nombre"
            />
          </div>
          <div>
            <Label htmlFor="vd">{t('campos.vigente_desde')}</Label>
            <Input
              id="vd"
              type="date"
              value={form.vigente_desde}
              onChange={(e) => setForm((f) => ({ ...f, vigente_desde: e.target.value }))}
              data-testid="plantilla-vigente-desde"
            />
          </div>
          <div>
            <Label htmlFor="vh">{t('campos.vigente_hasta')}</Label>
            <Input
              id="vh"
              type="date"
              value={form.vigente_hasta}
              onChange={(e) => setForm((f) => ({ ...f, vigente_hasta: e.target.value }))}
              data-testid="plantilla-vigente-hasta"
            />
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={pending || form.nombre.trim().length < 2}
            data-testid="plantilla-guardar"
          >
            {pending ? t('guardando') : t('guardar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
