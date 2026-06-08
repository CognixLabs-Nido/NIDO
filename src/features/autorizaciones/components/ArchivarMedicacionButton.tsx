'use client'

import { useTransition } from 'react'

import { ArchiveIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { archivarMedicacion } from '../actions/archivar-medicacion'

/**
 * Botón "Archivar" para una pauta de medicación terminada (solo profe/admin). Llama
 * al RPC vía la action y refresca; si no hay permiso, muestra el error. La familia
 * no recibe este botón (la página no se lo pasa).
 */
export function ArchivarMedicacionButton({ autorizacionId }: { autorizacionId: string }) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function archivar() {
    startTransition(async () => {
      const res = await archivarMedicacion(autorizacionId)
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('archivar.archivada_toast'))
      router.refresh()
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={archivar} disabled={pending}>
      <ArchiveIcon className="mr-1 size-4" />
      {pending ? t('archivar.archivando') : t('archivar.accion')}
    </Button>
  )
}
