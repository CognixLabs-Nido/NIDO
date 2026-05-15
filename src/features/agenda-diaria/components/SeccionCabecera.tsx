'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { upsertAgendaCabecera } from '../actions/upsert-agenda-cabecera'
import type { EstadoGeneral, Humor } from '../schemas/agenda-diaria'

interface Props {
  ninoId: string
  fecha: string
  initial: {
    estado_general: EstadoGeneral | null
    humor: Humor | null
    observaciones_generales: string | null
  } | null
  diaCerrado: boolean
}

const ESTADOS: EstadoGeneral[] = ['bien', 'regular', 'mal', 'mixto']
const HUMORES: Humor[] = ['feliz', 'tranquilo', 'inquieto', 'triste', 'cansado']

export function SeccionCabecera({ ninoId, fecha, initial, diaCerrado }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [estado, setEstado] = useState<EstadoGeneral | ''>(initial?.estado_general ?? '')
  const [humor, setHumor] = useState<Humor | ''>(initial?.humor ?? '')
  const [obs, setObs] = useState<string>(initial?.observaciones_generales ?? '')
  const [pending, startTransition] = useTransition()

  const estadoItems = ESTADOS.map((v) => ({ value: v, label: t(`estado_general_opciones.${v}`) }))
  const humorItems = HUMORES.map((v) => ({ value: v, label: t(`humor_opciones.${v}`) }))

  function guardar() {
    startTransition(async () => {
      const r = await upsertAgendaCabecera({
        nino_id: ninoId,
        fecha,
        estado_general: estado === '' ? null : estado,
        humor: humor === '' ? null : humor,
        observaciones_generales: obs.trim() === '' ? null : obs,
      })
      if (r.success) toast.success(t('guardado'))
      else toast.error(tErrors(r.error))
    })
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t('campos.estado_general')}</Label>
          <Select
            items={estadoItems}
            value={estado || undefined}
            onValueChange={(v) => setEstado(v as EstadoGeneral)}
            disabled={diaCerrado}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {estadoItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('campos.humor')}</Label>
          <Select
            items={humorItems}
            value={humor || undefined}
            onValueChange={(v) => setHumor(v as Humor)}
            disabled={diaCerrado}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {humorItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t('campos.observaciones_generales')}</Label>
        <Textarea
          rows={2}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          disabled={diaCerrado}
          maxLength={500}
        />
      </div>
      {!diaCerrado && (
        <div className="flex justify-end">
          <Button type="button" onClick={guardar} disabled={pending} size="sm">
            {pending ? t('guardando') : t('guardar')}
          </Button>
        </div>
      )}
    </div>
  )
}
