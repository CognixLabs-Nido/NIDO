'use client'

import { useMemo, useState, useTransition } from 'react'

import { UsersIcon } from 'lucide-react'
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

import { crearRecogida } from '../actions/crear-recogida'
import { adjuntosDeEdicion } from '../lib/datos-firma'
import { modalidadRecogidaEnum, type ModalidadRecogida } from '../schemas/autorizaciones'
import type { PersonaAutorizada, PersonaAutorizadaEdit } from '../types'
import { FirmaPad } from './FirmaPad'
import { PersonasAutorizadasEditor } from './PersonasAutorizadasEditor'

interface NinoOption {
  id: string
  nombre: string
  apellidos: string
}

/**
 * Flujo familia (B2): el tutor inicia una recogida para su hijo desde el formato
 * publicado. Elige niño + modalidad (habitual/puntual), rellena la lista de
 * personas (nombre+DNI+parentesco), confirma y firma con el dedo. Crea la
 * instancia y la firma en un paso (`crearRecogida`). La lista se prefilla con la
 * habitual vigente del niño (multi-tutor). ⚖️ avisa de los DNIs de terceros.
 */
export function CrearRecogidaDialog({
  ninos,
  prefillPorNino,
  currentUserNombre,
}: {
  ninos: NinoOption[]
  prefillPorNino: Record<string, PersonaAutorizada[]>
  currentUserNombre: string
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ninoId, setNinoId] = useState('')
  const [modalidad, setModalidad] = useState<ModalidadRecogida>('habitual')
  const [personas, setPersonas] = useState<PersonaAutorizadaEdit[]>([
    { nombre: '', dni: '', parentesco: '' },
  ])
  const [confirmo, setConfirmo] = useState(false)
  const [nombre, setNombre] = useState(currentUserNombre)
  const [firma, setFirma] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const ninoItems = useMemo(
    () => ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` })),
    [ninos]
  )
  const modalidadItems = useMemo(
    () =>
      modalidadRecogidaEnum.options.map((v) => ({ value: v, label: t(`recogida.modalidad_${v}`) })),
    [t]
  )

  function elegirNino(v: string) {
    setNinoId(v)
    const pre = prefillPorNino[v]
    setPersonas(
      pre && pre.length > 0 ? pre.map((p) => ({ ...p })) : [{ nombre: '', dni: '', parentesco: '' }]
    )
  }

  const personasValidas = personas
    .map((p) => ({ ...p, nombre: p.nombre.trim(), dni: p.dni.trim() }))
    .filter((p) => p.nombre.length > 0 && p.dni.length > 0)

  function reset() {
    setNinoId('')
    setModalidad('habitual')
    setPersonas([{ nombre: '', dni: '', parentesco: '' }])
    setConfirmo(false)
    setFirma(null)
  }

  function onSubmit() {
    if (!ninoId) {
      toast.error(t('validation.nino_requerido'))
      return
    }
    if (personasValidas.length === 0) {
      toast.error(t('validation.personas_vacio'))
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
      const res = await crearRecogida({
        nino_id: ninoId,
        modalidad,
        personas: personasValidas,
        adjuntos: adjuntosDeEdicion(personas),
        nombre_tecleado: nombre.trim(),
        firma_imagen: firma,
        comentario: null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('recogida.creada_toast'))
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <UsersIcon className="mr-1 size-4" />
            {t('recogida.crear')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('recogida.crear')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-muted-foreground text-sm">{t('recogida.intro')}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('form.nino')}</Label>
              <Select items={ninoItems} value={ninoId} onValueChange={(v) => elegirNino(v ?? '')}>
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
            <div className="space-y-2">
              <Label>{t('recogida.modalidad')}</Label>
              <Select
                items={modalidadItems}
                value={modalidad}
                onValueChange={(v) => setModalidad((v ?? 'habitual') as ModalidadRecogida)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modalidadItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <PersonasAutorizadasEditor
            value={personas}
            onChange={setPersonas}
            disabled={pending}
            ninoId={ninoId || undefined}
          />

          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {t('recogida.rgpd_terceros')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="recogida-nombre">{t('firma.nombre')}</Label>
            <Input
              id="recogida-nombre"
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
