'use client'

import { UserMinusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

import { darDeBajaNino } from '../actions/dar-de-baja-nino'

interface Props {
  ninoId: string
  /** Centro del niño (reservado; la RPC deriva el centro del propio niño). */
  centroId: string
  /** Nombre completo exacto — el usuario debe teclearlo para confirmar (anti-accidente). */
  nombreCompleto: string
  locale: string
}

/**
 * F-3-D — botón de Dirección para dar de baja a un niño en mitad de curso. Doble
 * gate anti-accidente: (1) motivo obligatorio; (2) teclear el nombre completo del
 * niño. La baja archiva al niño y, si es hijo único, corta el acceso de sus tutores
 * (lógica atómica en la RPC `baja_nino`). Tras la baja redirige al listado (la ficha
 * ya no carga un niño archivado).
 */
export function DarDeBajaNinoButton({ ninoId, nombreCompleto, locale }: Props) {
  const t = useTranslations('admin.ninos.baja')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [confirmNombre, setConfirmNombre] = useState('')
  const [pending, startTransition] = useTransition()

  const motivoOk = motivo.trim().length > 0 && motivo.trim().length <= 500
  const nombreOk = confirmNombre === nombreCompleto
  const puedeConfirmar = motivoOk && nombreOk && !pending

  function reset() {
    setMotivo('')
    setConfirmNombre('')
  }

  function confirmar() {
    if (!puedeConfirmar) return
    startTransition(async () => {
      const r = await darDeBajaNino({ nino_id: ninoId, motivo: motivo.trim() })
      if (r.success) {
        toast.success(t('exito'))
        setOpen(false)
        reset()
        router.push(`/${locale}/admin/ninos`)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="dar-de-baja-button"
      >
        <UserMinusIcon />
        {t('boton')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titulo')}</DialogTitle>
            <DialogDescription>{t('aviso', { nombre: nombreCompleto })}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="baja-motivo">{t('motivo_label')}</Label>
              <Textarea
                id="baja-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                placeholder={t('motivo_placeholder')}
                data-testid="dar-de-baja-motivo"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baja-nombre">{t('confirm_nombre_label')}</Label>
              <Input
                id="baja-nombre"
                value={confirmNombre}
                onChange={(e) => setConfirmNombre(e.target.value)}
                placeholder={nombreCompleto}
                autoComplete="off"
                data-testid="dar-de-baja-nombre"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              {t('cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive-strong"
              onClick={confirmar}
              disabled={!puedeConfirmar}
              data-testid="dar-de-baja-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
