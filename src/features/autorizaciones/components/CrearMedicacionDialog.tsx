'use client'

import { useMemo, useState, useTransition } from 'react'

import { PillIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

import { crearMedicacion } from '../actions/crear-medicacion'
import type { MedicacionDatos } from '../types'
import { FirmaPad } from './FirmaPad'
import { MedicacionCamposEditor } from './MedicacionCamposEditor'

interface NinoOption {
  id: string
  nombre: string
  apellidos: string
}

/** Hoy en huso Madrid como YYYY-MM-DD (default de las fechas). */
function hoyMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

function medicacionVacia(): MedicacionDatos {
  const hoy = hoyMadrid()
  return { medicamento: '', dosis: '', via: '', pauta: '', fecha_inicio: hoy, fecha_fin: hoy }
}

/**
 * Flujo familia (B2): el tutor inicia una medicación para su hijo desde el formato
 * publicado. Elige niño, rellena los campos (medicamento/dosis/vía/pauta/fechas),
 * confirma y firma con el dedo. Crea la instancia y la firma en un paso
 * (`crearMedicacion`). Medicación es multi-instancia: cada tratamiento es uno nuevo.
 */
export function CrearMedicacionDialog({
  ninos,
  currentUserNombre,
}: {
  ninos: NinoOption[]
  currentUserNombre: string
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ninoId, setNinoId] = useState('')
  const [med, setMed] = useState<MedicacionDatos>(medicacionVacia)
  const [confirmo, setConfirmo] = useState(false)
  const [nombre, setNombre] = useState(currentUserNombre)
  const [firma, setFirma] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const ninoItems = useMemo(
    () => ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` })),
    [ninos]
  )

  function reset() {
    setNinoId('')
    setMed(medicacionVacia())
    setConfirmo(false)
    setFirma(null)
  }

  function onSubmit() {
    if (!ninoId) {
      toast.error(t('validation.nino_requerido'))
      return
    }
    if (!med.medicamento.trim() || !med.dosis.trim() || !med.pauta.trim()) {
      toast.error(t('validation.med_campos_requeridos'))
      return
    }
    if (!confirmo) {
      toast.error(t('errors.confirma_requerido'))
      return
    }
    if (!firma) {
      toast.error(t('validation.firma_requerida'))
      return
    }
    startTransition(async () => {
      const res = await crearMedicacion({
        nino_id: ninoId,
        medicacion: med,
        nombre_tecleado: nombre.trim(),
        firma_imagen: firma,
        comentario: null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('medicacion.creada_toast'))
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <PillIcon className="mr-1 size-4" />
            {t('medicacion.crear')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('medicacion.crear')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-muted-foreground text-sm">{t('medicacion.intro')}</p>

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

          <MedicacionCamposEditor value={med} onChange={setMed} disabled={pending} />

          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('medicacion.aviso')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="med-nombre">{t('firma.nombre')}</Label>
            <Input
              id="med-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={200}
            />
            <p className="text-muted-foreground text-xs">{t('firma.nombre_ayuda')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('firma.trazo')}</Label>
            <FirmaPad onChange={setFirma} disabled={pending} />
            <p className="text-muted-foreground text-xs">{t('firma.pad_ayuda')}</p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmo} onCheckedChange={(c) => setConfirmo(c === true)} />
            <span>{t('firma.confirmo')}</span>
          </label>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('recogida.firmando') : t('acciones.firmar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
