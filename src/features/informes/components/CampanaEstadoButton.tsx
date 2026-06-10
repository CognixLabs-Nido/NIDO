'use client'

import { useTransition } from 'react'

import { LockIcon, LockOpenIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { cambiarEstadoCampana } from '../actions/gestionar-campana-informe'
import type { EstadoCampanaInforme } from '../types'

/**
 * Botón para cerrar/reabrir una campaña (solo dirección). Cerrar apaga el aviso de
 * pendientes pero **no toca los informes** (capa-no-puerta); reversible (Q4).
 */
export function CampanaEstadoButton({
  campanaId,
  estado,
}: {
  campanaId: string
  estado: EstadoCampanaInforme
}) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const cerrar = estado === 'abierta'
  const nuevoEstado: EstadoCampanaInforme = cerrar ? 'cerrada' : 'abierta'

  function onClick() {
    startTransition(async () => {
      const res = await cambiarEstadoCampana({ campana_id: campanaId, estado: nuevoEstado })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(
        cerrar ? t('campana.acciones.cerrada_toast') : t('campana.acciones.reabierta_toast')
      )
      router.refresh()
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending} aria-busy={pending}>
      {cerrar ? <LockIcon className="mr-1 size-4" /> : <LockOpenIcon className="mr-1 size-4" />}
      {pending
        ? t('campana.acciones.procesando')
        : cerrar
          ? t('campana.cerrar')
          : t('campana.acciones.reabrir')}
    </Button>
  )
}
