'use client'

import { useTransition } from 'react'

import { BanIcon, SendIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { anularAutorizacion, publicarAutorizacion } from '../actions/gestionar-autorizacion'
import type { AutorizacionEstado } from '../types'

interface Props {
  autorizacionId: string
  estado: AutorizacionEstado
  textoDefinitivo: boolean
}

/** Botones admin: publicar (borrador con texto definitivo) y anular. */
export function AccionesAdmin({ autorizacionId, estado, textoDefinitivo }: Props) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function publicar() {
    startTransition(async () => {
      const res = await publicarAutorizacion({ autorizacion_id: autorizacionId })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.publicada_toast'))
      router.refresh()
    })
  }

  function anular() {
    startTransition(async () => {
      const res = await anularAutorizacion({ autorizacion_id: autorizacionId })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.anulada_toast'))
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {estado === 'borrador' && (
        <Button onClick={publicar} disabled={pending || !textoDefinitivo}>
          <SendIcon className="mr-1 size-4" />
          {t('acciones.publicar')}
        </Button>
      )}
      {estado !== 'anulada' && (
        <Button variant="outline" onClick={anular} disabled={pending}>
          <BanIcon className="mr-1 size-4" />
          {t('acciones.anular')}
        </Button>
      )}
    </div>
  )
}
