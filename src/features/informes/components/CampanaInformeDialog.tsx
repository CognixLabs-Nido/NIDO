'use client'

import { useState, useTransition } from 'react'

import { CalendarPlusIcon, PencilIcon } from 'lucide-react'
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

import { abrirCampanaInforme, editarFechaCampana } from '../actions/gestionar-campana-informe'
import { PERIODOS_INFORME, type CampanaInformeItem, type PeriodoInforme } from '../types'

/**
 * Diálogo para **abrir** una campaña (elige período + fecha límite) o **editar la
 * fecha** de una existente. Sin `campana` = abrir; con `campana` = editar fecha
 * (el período queda fijo: es la terna UNIQUE). Solo dirección. La validación real
 * está en el server (Zod); aquí solo hay comprobaciones de UX.
 */
export function CampanaInformeDialog({
  campana,
  periodosOcupados = [],
}: {
  campana?: CampanaInformeItem
  /** Períodos que ya tienen campaña (para no ofrecer duplicados al abrir). */
  periodosOcupados?: PeriodoInforme[]
}) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const esEdicion = !!campana

  const periodosDisponibles = PERIODOS_INFORME.filter((p) => !periodosOcupados.includes(p))

  const [open, setOpen] = useState(false)
  const [periodo, setPeriodo] = useState<PeriodoInforme | ''>(
    campana?.periodo ?? periodosDisponibles[0] ?? ''
  )
  const [fechaLimite, setFechaLimite] = useState(campana?.fecha_limite ?? '')
  const [pending, startTransition] = useTransition()

  function reset() {
    setPeriodo(campana?.periodo ?? periodosDisponibles[0] ?? '')
    setFechaLimite(campana?.fecha_limite ?? '')
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function onSubmit() {
    if (!esEdicion && periodo === '') {
      toast.error(tRoot('informes.campana.validation.periodo_invalido'))
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimite)) {
      toast.error(tRoot('informes.campana.validation.fecha_invalida'))
      return
    }

    startTransition(async () => {
      const res = esEdicion
        ? await editarFechaCampana({ campana_id: campana.id, fecha_limite: fechaLimite })
        : await abrirCampanaInforme({
            periodo: periodo as PeriodoInforme,
            fecha_limite: fechaLimite,
          })

      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(
        esEdicion ? t('campana.acciones.fecha_guardada_toast') : t('campana.acciones.abierta_toast')
      )
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
              {t('campana.acciones.editar_fecha')}
            </Button>
          ) : (
            <Button disabled={periodosDisponibles.length === 0}>
              <CalendarPlusIcon className="mr-1 size-4" />
              {t('campana.abrir')}
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {esEdicion ? t('campana.acciones.editar_fecha') : t('campana.abrir')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="campana-periodo">{t('campana.periodo')}</Label>
            {esEdicion ? (
              <p id="campana-periodo" className="text-foreground text-sm font-medium">
                {t(`periodos.${campana.periodo}`)}
              </p>
            ) : (
              <Select
                items={periodosDisponibles.map((p) => ({ value: p, label: t(`periodos.${p}`) }))}
                value={periodo === '' ? null : periodo}
                onValueChange={(v) => setPeriodo((v as PeriodoInforme) ?? '')}
              >
                <SelectTrigger id="campana-periodo">
                  <SelectValue placeholder={t('campana.periodo_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {periodosDisponibles.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`periodos.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="campana-fecha">{t('campana.fecha_limite')}</Label>
            <Input
              id="campana-fecha"
              type="date"
              value={fechaLimite}
              onChange={(e) => setFechaLimite(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending} aria-busy={pending}>
            {pending
              ? t('campana.acciones.guardando')
              : esEdicion
                ? t('campana.acciones.guardar_fecha')
                : t('campana.acciones.abrir_confirmar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
