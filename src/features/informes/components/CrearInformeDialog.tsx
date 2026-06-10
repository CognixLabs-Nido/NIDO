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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { crearInformeEvolucion } from '../actions/gestionar-informe'
import { PERIODOS_INFORME, type PeriodoInforme } from '../types'

interface Option {
  id: string
  label: string
}

/**
 * Diálogo «Nuevo informe» (solo coordinadora/profesora). Elige niño (de sus
 * aulas) + período + plantilla activa; el server congela el snapshot y, si la
 * terna ya existe, abre el existente (no duplica). Tras crear, navega al detalle
 * para rellenarlo.
 */
export function CrearInformeDialog({
  locale,
  ninos,
  plantillas,
}: {
  locale: string
  ninos: Option[]
  plantillas: Option[]
}) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ninoId, setNinoId] = useState('')
  const [periodo, setPeriodo] = useState<PeriodoInforme | ''>('')
  const [plantillaId, setPlantillaId] = useState('')
  const [pending, startTransition] = useTransition()

  const periodoItems = useMemo(
    () => PERIODOS_INFORME.map((p) => ({ value: p, label: t(`periodos.${p}`) })),
    [t]
  )
  const ninoItems = useMemo(() => ninos.map((n) => ({ value: n.id, label: n.label })), [ninos])
  const plantillaItems = useMemo(
    () => plantillas.map((p) => ({ value: p.id, label: p.label })),
    [plantillas]
  )

  function reset() {
    setNinoId('')
    setPeriodo('')
    setPlantillaId('')
  }

  function onSubmit() {
    if (!ninoId || !periodo || !plantillaId) {
      toast.error(t('crear.incompleto'))
      return
    }
    startTransition(async () => {
      const res = await crearInformeEvolucion({
        nino_id: ninoId,
        periodo,
        plantilla_id: plantillaId,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      setOpen(false)
      reset()
      router.push(`/${locale}/teacher/informes/${res.data.informe_id}`)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <PlusIcon className="mr-1 size-4" />
            {t('crear.nuevo')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('crear.nuevo')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('crear.nino')}</Label>
            <Select items={ninoItems} value={ninoId} onValueChange={(v) => setNinoId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('crear.nino_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {ninos.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('crear.periodo')}</Label>
            <Select
              items={periodoItems}
              value={periodo}
              onValueChange={(v) => setPeriodo((v ?? '') as PeriodoInforme | '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('crear.periodo_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {periodoItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('crear.plantilla')}</Label>
            <Select
              items={plantillaItems}
              value={plantillaId}
              onValueChange={(v) => setPlantillaId(v ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('crear.plantilla_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {plantillas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plantillas.length === 0 && (
              <p className="text-muted-foreground text-sm">{t('crear.sin_plantillas')}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending || plantillas.length === 0}>
            {pending ? t('crear.creando') : t('crear.continuar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
