'use client'

import { CheckIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { eliminarPublicacion } from '../actions/gestionar-publicacion'
import { resolverEtiquetaImagen } from '../actions/resolver-etiqueta'
import type { FotoPendiente } from '../queries/get-fotos-pendientes-nino'

interface Props {
  foto: FotoPendiente
}

/**
 * IU-5 — una foto pendiente de un niño revocado, con acciones de Dirección:
 *  - Marcar resuelta: sella la etiqueta (foto×niño) sin borrar la foto.
 *  - Borrar publicación: elimina el post entero (reusa `eliminarPublicacion`). Si la
 *    publicación etiqueta a más niños, se AVISA antes de confirmar (efecto colateral).
 * Al resolver/borrar, la card sale del listado (`router.refresh`).
 */
export function FotoPendienteCard({ foto }: Props) {
  const t = useTranslations('admin.fotosRevocadas')
  const tErrors = useTranslations()
  const router = useRouter()
  const [confirmBorrar, setConfirmBorrar] = useState(false)
  const [pending, startTransition] = useTransition()

  const otrosNinos = Math.max(0, foto.ninosEnPublicacion - 1)

  function marcarResuelta() {
    startTransition(async () => {
      const r = await resolverEtiquetaImagen({ media_etiqueta_id: foto.etiquetaId })
      if (r.success) {
        toast.success(t('resuelta_ok'))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function borrarPublicacion() {
    startTransition(async () => {
      const r = await eliminarPublicacion({ publicacion_id: foto.publicacionId })
      if (r.success) {
        toast.success(t('borrada_ok'))
        setConfirmBorrar(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted relative aspect-square w-full">
        {foto.urlMiniatura ? (
          <Image
            src={foto.urlMiniatura}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 240px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            {t('sin_miniatura')}
          </div>
        )}
      </div>
      <CardContent className="space-y-2 pt-3">
        {otrosNinos > 0 && (
          <p className="text-warning-700 flex items-center gap-1 text-xs">
            <UsersIcon className="size-3.5" />
            {t('otros_ninos', { count: otrosNinos })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={marcarResuelta}
            disabled={pending}
            data-testid="marcar-resuelta"
          >
            <CheckIcon />
            {t('marcar_resuelta')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirmBorrar(true)}
            disabled={pending}
            data-testid="borrar-publicacion"
          >
            <Trash2Icon />
            {t('borrar_publicacion')}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmBorrar} onOpenChange={setConfirmBorrar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('borrar_titulo')}</DialogTitle>
            <DialogDescription>
              {otrosNinos > 0 ? t('borrar_aviso_varios', { count: otrosNinos }) : t('borrar_aviso')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmBorrar(false)}>
              {t('cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive-strong"
              onClick={borrarPublicacion}
              disabled={pending}
              data-testid="borrar-publicacion-confirm"
            >
              {pending ? t('procesando') : t('borrar_confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
