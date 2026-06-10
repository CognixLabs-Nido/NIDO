'use client'

import { useTransition } from 'react'

import { SendIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { publicarLoteInformes } from '../actions/publicar-lote-informes'

/**
 * Botón "Publicar todos" (F9-5-3). Publica en lote los informes COMPLETOS en
 * borrador de una campaña abierta: una aula (`aulaId`) o todo el centro (sin
 * `aulaId`). Best-effort: el toast resume publicados vs incompletos. La RLS decide
 * qué puede publicar realmente cada rol.
 */
export function PublicarLoteButton({
  campanaId,
  aulaId,
  label,
  variant = 'outline',
}: {
  campanaId: string
  aulaId?: string
  label: string
  variant?: 'default' | 'outline'
}) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const res = await publicarLoteInformes({ campana_id: campanaId, aula_id: aulaId })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      const { total, publicados, incompletos } = res.data
      if (total === 0) {
        toast.info(t('campana.lote_vacio'))
      } else {
        toast.success(t('campana.lote_resultado', { publicados, incompletos }))
      }
      router.refresh()
    })
  }

  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={pending} aria-busy={pending}>
      <SendIcon className="mr-1 size-4" />
      {pending ? t('campana.acciones.publicando') : label}
    </Button>
  )
}
