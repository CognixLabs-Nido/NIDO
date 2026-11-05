'use client'

import { useState, useTransition } from 'react'

import { Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { borrarVersionDocumentoAccion } from '../actions/versiones'

/**
 * Borra una versión sin firmas (J5), con confirmación. Si la base encuentra una firma que la admin no
 * ve, contesta `version_firmada` y se dice. Si el fichero no se va, la versión ya no existe y se dice
 * que el fichero queda pendiente de borrar (sale arriba, con «reintentar»).
 */
export function BorrarVersionDialog({ versionId, numero }: { versionId: string; numero: number }) {
  const t = useTranslations('documentos_centro.pantalla')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function borrar() {
    startTransition(async () => {
      const r = await borrarVersionDocumentoAccion(versionId)
      if (!r.success) {
        toast.error(tRoot(r.error))
        return
      }
      if (r.data.ficheroBorrado) toast.success(t('borrada'))
      else toast.warning(t('borrada_fichero_pendiente'))
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={t('borrar_version', { numero })}>
            <Trash2Icon className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('borrar_version', { numero })}</DialogTitle>
          <DialogDescription>{t('borrar_explicacion')}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancelar')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={borrar}>
            {t('borrar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
