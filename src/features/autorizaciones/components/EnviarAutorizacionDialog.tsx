'use client'

import { useMemo, useState, useTransition } from 'react'

import { SendIcon } from 'lucide-react'
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

import { enviarAutorizacion } from '../actions/gestionar-autorizacion'
import { ambitoEnvioEnum } from '../schemas/autorizaciones'
import type { PlantillaEnviableItem } from '../types'

interface NinoOption {
  id: string
  nombre: string
  apellidos: string
}
interface AulaOption {
  id: string
  nombre: string
}
type Ambito = (typeof ambitoEnvioEnum.options)[number]

/**
 * Diálogo admin: **envía** una plantilla publicada (tipo A: reglas/imágenes) a
 * una AUDIENCIA (niño/aula/centro), creando una instancia firmable (snapshot del
 * texto). Reusa los selectores de niño/aula con la prop `items` de base-ui para
 * que el trigger muestre el NOMBRE (no el UUID — bug #1). recogida/medicación no
 * aparecen: las inicia la familia.
 */
export function EnviarAutorizacionDialog({
  plantillas,
  ninos,
  aulas,
}: {
  plantillas: PlantillaEnviableItem[]
  ninos: NinoOption[]
  aulas: AulaOption[]
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [plantillaId, setPlantillaId] = useState('')
  const [ambito, setAmbito] = useState<Ambito | ''>('')
  const [ninoId, setNinoId] = useState('')
  const [aulaId, setAulaId] = useState('')
  const [pending, startTransition] = useTransition()

  const plantillaItems = useMemo(
    () => plantillas.map((p) => ({ value: p.id, label: `${p.titulo} · ${t(`tipo.${p.tipo}`)}` })),
    [plantillas, t]
  )
  const ambitoItems = useMemo(
    () => ambitoEnvioEnum.options.map((v) => ({ value: v, label: t(`ambito.${v}`) })),
    [t]
  )
  const ninoItems = useMemo(
    () => ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` })),
    [ninos]
  )
  const aulaItems = useMemo(() => aulas.map((a) => ({ value: a.id, label: a.nombre })), [aulas])

  function reset() {
    setPlantillaId('')
    setAmbito('')
    setNinoId('')
    setAulaId('')
  }

  function onSubmit() {
    if (!plantillaId || !ambito) {
      toast.error(t('errors.envio_fallo'))
      return
    }
    startTransition(async () => {
      const res = await enviarAutorizacion({
        plantilla_id: plantillaId,
        ambito,
        nino_id: ambito === 'nino' ? ninoId || null : null,
        aula_id: ambito === 'aula' ? aulaId || null : null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.enviada_toast'))
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" disabled={plantillas.length === 0}>
            <SendIcon className="mr-1 size-4" />
            {t('acciones.enviar')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('acciones.enviar')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t('enviar.intro')}</p>

          <div className="space-y-2">
            <Label>{t('form.plantilla')}</Label>
            <Select
              items={plantillaItems}
              value={plantillaId}
              onValueChange={(v) => setPlantillaId(v ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('form.plantilla_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {plantillaItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('form.ambito')}</Label>
            <Select
              items={ambitoItems}
              value={ambito}
              onValueChange={(v) => {
                setAmbito((v ?? '') as Ambito | '')
                setNinoId('')
                setAulaId('')
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('form.ambito_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {ambitoItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {ambito === 'nino' && (
            <div className="space-y-2">
              <Label>{t('form.nino')}</Label>
              <Select items={ninoItems} value={ninoId} onValueChange={(v) => setNinoId(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('form.nino_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {ninoItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {ambito === 'aula' && (
            <div className="space-y-2">
              <Label>{t('form.aula')}</Label>
              <Select items={aulaItems} value={aulaId} onValueChange={(v) => setAulaId(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('form.aula_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {aulaItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('acciones.enviando') : t('acciones.enviar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
