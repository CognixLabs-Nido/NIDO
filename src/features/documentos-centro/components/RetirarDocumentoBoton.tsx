'use client'

import { useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { editarDocumentoAccion } from '../actions/documentos'

/** Retirar un documento, o volver a ponerlo, sin borrar nada (3a: `retirado_at`). */
export function RetirarDocumentoBoton({
  documentoId,
  retirado,
}: {
  documentoId: string
  retirado: boolean
}) {
  const t = useTranslations('documentos_centro.pantalla')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function cambiar() {
    startTransition(async () => {
      const r = await editarDocumentoAccion({ documentoId, retirado: !retirado })
      if (!r.success) {
        toast.error(tRoot(r.error))
        return
      }
      toast.success(t(retirado ? 'repuesto' : 'retirado_ok'))
      router.refresh()
    })
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={cambiar}>
      {t(retirado ? 'volver_a_poner' : 'retirar')}
    </Button>
  )
}
