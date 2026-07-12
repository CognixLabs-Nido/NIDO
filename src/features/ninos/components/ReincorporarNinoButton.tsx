'use client'

import { UserPlusIcon } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

import { desarchivarNino } from '../actions/desarchivar-nino'

interface AulaOption {
  id: string
  nombre: string
}

interface Props {
  ninoId: string
  /** Nombre completo exacto — el usuario debe teclearlo para confirmar (anti-accidente). */
  nombreCompleto: string
  /** Aulas del curso ACTIVO del centro. Vacío ⇒ no hay curso activo (o sin aulas). */
  aulas: AulaOption[]
}

/**
 * F-3-F — botón de Dirección para REINCORPORAR (desarchivar) a un niño dado de baja.
 * NO es una acción destructiva (repara/reincorpora) → variante primaria, no
 * `destructive-strong`. Doble gate anti-accidente en el diálogo: (1) selector de aula
 * del curso activo OBLIGATORIO; (2) teclear el nombre completo del niño. Si no hay curso
 * activo (aulas vacío) se muestra el aviso y el botón queda deshabilitado. La RPC
 * `desarchivar_nino` revierte el archivado y abre una matrícula nueva. Tras el éxito
 * recarga la ficha (ya como niño activo).
 */
export function ReincorporarNinoButton({ ninoId, nombreCompleto, aulas }: Props) {
  const t = useTranslations('admin.ninos.desarchivar')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [aulaId, setAulaId] = useState('')
  const [confirmNombre, setConfirmNombre] = useState('')
  const [pending, startTransition] = useTransition()

  const sinCursoActivo = aulas.length === 0
  const aulaOk = aulaId.length > 0
  const nombreOk = confirmNombre === nombreCompleto
  const puedeConfirmar = !sinCursoActivo && aulaOk && nombreOk && !pending

  function reset() {
    setAulaId('')
    setConfirmNombre('')
  }

  function confirmar() {
    if (!puedeConfirmar) return
    startTransition(async () => {
      const r = await desarchivarNino({ nino_id: ninoId, aula_id: aulaId })
      if (r.success) {
        toast.success(t('exito'))
        setOpen(false)
        reset()
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="reincorporar-button"
      >
        <UserPlusIcon />
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

          {sinCursoActivo ? (
            <div className="border-warm-300 bg-warm-100 text-warm-800 rounded-xl border-l-4 px-4 py-3 text-sm">
              {t('sin_curso_activo')}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reinc-aula">{t('aula_label')}</Label>
                <Select value={aulaId} onValueChange={(v) => setAulaId(v ?? '')}>
                  <SelectTrigger id="reinc-aula" data-testid="reincorporar-aula">
                    <SelectValue placeholder={t('aula_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {aulas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reinc-nombre">{t('confirm_nombre_label')}</Label>
                <Input
                  id="reinc-nombre"
                  value={confirmNombre}
                  onChange={(e) => setConfirmNombre(e.target.value)}
                  placeholder={nombreCompleto}
                  autoComplete="off"
                  data-testid="reincorporar-nombre"
                />
              </div>
            </div>
          )}

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
              onClick={confirmar}
              disabled={!puedeConfirmar}
              data-testid="reincorporar-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
