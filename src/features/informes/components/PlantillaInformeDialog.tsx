'use client'

import { useState, useTransition } from 'react'

import { PencilIcon, PlusIcon } from 'lucide-react'
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
  crearPlantillaInforme,
  editarPlantillaInforme,
} from '../actions/gestionar-plantilla-informe'
import type { AreaInforme, PlantillaInformeItem } from '../types'

import { EstructuraEditor } from './EstructuraEditor'

/** Estructura inicial al crear: un área con un ítem vacío para arrancar. */
function estructuraInicial(): AreaInforme[] {
  return [{ titulo: '', items: [{ id: globalThis.crypto.randomUUID(), texto: '' }] }]
}

/** ¿La estructura cumple el mínimo para guardar? (≥1 área, cada una con ≥1 ítem
 *  no vacío, y título de área no vacío). Validación de UX; el server revalida. */
function estructuraValida(areas: AreaInforme[]): boolean {
  if (areas.length === 0) return false
  return areas.every(
    (a) =>
      a.titulo.trim().length > 0 &&
      a.items.length > 0 &&
      a.items.every((it) => it.texto.trim().length > 0)
  )
}

/**
 * Diálogo de creación/edición de una plantilla de informe (solo dirección). Sin
 * `plantilla` = crear; con `plantilla` = editar (pre-rellenado). Editar solo
 * afecta a informes nuevos (los pasados llevan snapshot).
 */
export function PlantillaInformeDialog({ plantilla }: { plantilla?: PlantillaInformeItem }) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const esEdicion = !!plantilla

  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState(plantilla?.titulo ?? '')
  const [areas, setAreas] = useState<AreaInforme[]>(plantilla?.estructura ?? estructuraInicial())
  const [pending, startTransition] = useTransition()

  function reset() {
    setTitulo(plantilla?.titulo ?? '')
    setAreas(plantilla?.estructura ?? estructuraInicial())
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function onSubmit() {
    if (titulo.trim().length === 0) {
      toast.error(tRoot('informes.validation.nombre_vacio'))
      return
    }
    if (!estructuraValida(areas)) {
      toast.error(tRoot('informes.validation.sin_areas'))
      return
    }

    startTransition(async () => {
      const res = esEdicion
        ? await editarPlantillaInforme({
            plantilla_id: plantilla.id,
            titulo: titulo.trim(),
            estructura: areas,
          })
        : await crearPlantillaInforme({ titulo: titulo.trim(), estructura: areas })

      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(esEdicion ? t('acciones.guardada_toast') : t('acciones.creada_toast'))
      setOpen(false)
      if (!esEdicion) reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          esEdicion ? (
            <Button variant="outline" size="sm">
              <PencilIcon className="mr-1 size-4" />
              {t('acciones.editar')}
            </Button>
          ) : (
            <Button>
              <PlusIcon className="mr-1 size-4" />
              {t('acciones.nueva')}
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{esEdicion ? t('acciones.editar') : t('acciones.nueva')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="plantilla-nombre">{t('form.nombre')}</Label>
            <Input
              id="plantilla-nombre"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder={t('form.nombre_placeholder')}
            />
          </div>
          <EstructuraEditor value={areas} onChange={setAreas} />
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending
              ? esEdicion
                ? t('acciones.guardando')
                : t('acciones.creando')
              : esEdicion
                ? t('acciones.guardar')
                : t('acciones.crear')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
