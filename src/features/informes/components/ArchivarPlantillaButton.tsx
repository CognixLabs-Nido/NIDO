'use client'

import { useTransition } from 'react'

import { ArchiveIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { archivarPlantillaInforme } from '../actions/gestionar-plantilla-informe'

/**
 * Archiva una plantilla de informe (solo admin). No la borra: deja de ofrecerse
 * para informes nuevos pero los pasados conservan su snapshot.
 */
export function ArchivarPlantillaButton({ plantillaId }: { plantillaId: string }) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function archivar() {
    startTransition(async () => {
      const res = await archivarPlantillaInforme({ plantilla_id: plantillaId })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.archivada_toast'))
      router.refresh()
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={archivar} disabled={pending}>
      <ArchiveIcon className="mr-1 size-4" />
      {pending ? t('acciones.archivando') : t('acciones.archivar')}
    </Button>
  )
}
