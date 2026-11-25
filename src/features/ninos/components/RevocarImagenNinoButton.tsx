'use client'

import { ImageOffIcon } from 'lucide-react'
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

import { revocarImagenNino } from '../actions/revocar-imagen-nino'

interface Props {
  ninoId: string
  nombreCompleto: string
  /** Textos del diálogo: Dirección (por defecto) o el tutor desde el portal de familia. */
  textos?:
    | 'admin.ninos.fotos.revocar'
    | 'family.nino.imagen.revocar'
    // La foto de perfil que sigue sin permiso de imagen (un revocar cuyo borrado falló): la misma
    // acción, que retira lo que quede y borra la foto primero (censo C, 2026-11-25).
    | 'admin.ninos.fotos.foto_sin_permiso'
}

/**
 * IU-4 — botón para revocar el consentimiento de imagen de un niño (Dirección o su tutor
 * legal; la misma acción). Revocar OCULTA al instante al niño de todas las publicaciones
 * donde aparece y ELIMINA su foto de perfil. No borra las fotos de las publicaciones
 * (Dirección las resuelve a mano en IU-5). Por-niño: no afecta a los hermanos.
 */
export function RevocarImagenNinoButton({
  ninoId,
  nombreCompleto,
  textos = 'admin.ninos.fotos.revocar',
}: Props) {
  const t = useTranslations(textos)
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await revocarImagenNino({ nino_id: ninoId })
      if (r.success) {
        toast.success(t('exito'))
        setOpen(false)
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
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="revocar-imagen-button"
      >
        <ImageOffIcon />
        {t('boton')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titulo')}</DialogTitle>
            <DialogDescription>{t('aviso', { nombre: nombreCompleto })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive-strong"
              onClick={confirmar}
              disabled={pending}
              data-testid="revocar-imagen-confirm"
            >
              {pending ? t('procesando') : t('confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
