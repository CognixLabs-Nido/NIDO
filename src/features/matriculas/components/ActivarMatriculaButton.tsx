'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { activarMatricula } from '@/features/matriculas/actions/activar-matricula'

interface Props {
  matriculaId: string
}

/**
 * Pieza 2b — botón "Activar matrícula" (admin). Flipea un esqueleto
 * `estado='pendiente'` → `'activa'` para que el niño entre en las lecturas
 * operativas (endurecimiento de la Pieza 2a).
 */
export function ActivarMatriculaButton({ matriculaId }: Props) {
  const t = useTranslations('admin.ninos')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const r = await activarMatricula(matriculaId)
      if (r.success) {
        toast.success(t('activar_matricula.ok'))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Button size="sm" disabled={pending} onClick={onClick}>
      {pending ? t('activar_matricula.activando') : t('activar_matricula.activar')}
    </Button>
  )
}
