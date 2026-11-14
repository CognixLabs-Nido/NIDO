'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { activarMatricula } from '@/features/matriculas/actions/activar-matricula'

interface Props {
  matriculaId: string
}

/**
 * Pieza 2b — botón "Activar matrícula" (admin): valida un alta que la familia ya terminó
 * (`'lista'` → `'activa'`) para que el niño entre en las lecturas operativas.
 *
 * Fase 8a: con la fecha de incorporación, obligatoria. Es el día en que el niño empieza a venir y
 * decide desde qué mes se le cobra; puede ser meses después de validar (un alta de enero para
 * septiembre). Sin fecha, el botón no se puede pulsar.
 */
export function ActivarMatriculaButton({ matriculaId }: Props) {
  const t = useTranslations('admin.ninos')
  const tErrors = useTranslations()
  const router = useRouter()
  const id = useId()
  const [fecha, setFecha] = useState('')
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!fecha) return
    startTransition(async () => {
      const r = await activarMatricula(matriculaId, fecha)
      if (r.success) {
        toast.success(t('activar_matricula.ok'))
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={id}>{t('activar_matricula.fecha_incorporacion')}</Label>
        <Input
          id={id}
          type="date"
          required
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="w-44"
        />
      </div>
      <Button size="sm" disabled={pending || !fecha} onClick={onClick}>
        {pending ? t('activar_matricula.activando') : t('activar_matricula.activar')}
      </Button>
    </div>
  )
}
