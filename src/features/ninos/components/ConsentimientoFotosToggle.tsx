'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

import { setPuedeAparecerEnFotos } from '../actions/set-puede-aparecer-fotos'

interface Props {
  ninoId: string
  initial: boolean
}

/**
 * Interruptor de **consentimiento de imagen** del niño (F10, P1). Solo dirección
 * lo gestiona; es el gate del etiquetado en el blog del aula. Revocarlo oculta
 * las publicaciones donde el niño está etiquetado (RLS de F10-0). Optimista con
 * revert si la acción falla.
 */
export function ConsentimientoFotosToggle({ ninoId, initial }: Props) {
  const t = useTranslations('admin.ninos.fotos')
  const tErrors = useTranslations()
  const [checked, setChecked] = useState(initial)
  const [pending, startTransition] = useTransition()

  function alternar(valor: boolean) {
    setChecked(valor)
    startTransition(async () => {
      const r = await setPuedeAparecerEnFotos({ nino_id: ninoId, puede_aparecer: valor })
      if (!r.success) {
        toast.error(tErrors(r.error))
        setChecked(!valor)
        return
      }
      toast.success(t('guardado'))
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="puede-aparecer-fotos"
          checked={checked}
          disabled={pending}
          onCheckedChange={(c) => alternar(c === true)}
        />
        <Label htmlFor="puede-aparecer-fotos" className="font-normal">
          {t('toggle_label')}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">{t('ayuda')}</p>
    </div>
  )
}
