'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { activarCurso } from '../actions/activar-curso'

export function ActivarCursoButton({ cursoId, disabled }: { cursoId: string; disabled?: boolean }) {
  const t = useTranslations('admin.cursos')
  const tErrors = useTranslations()
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await activarCurso(cursoId)
          if (r.success) toast.success(t('activated'))
          else toast.error(tErrors(r.error))
        })
      }
    >
      {pending ? t('activating') : t('activar')}
    </Button>
  )
}
