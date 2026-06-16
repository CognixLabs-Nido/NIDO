'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

interface Props {
  texto: string
  onBack: () => void
  /** Sin `onNext` en el último paso (imagen) hasta que 3b-2b cablee el cierre. */
  onNext?: () => void
}

/**
 * Placeholder de un paso pesado (médico / imagen) mientras 3b-2a establece el
 * esqueleto. 3b-2b lo sustituye por la ficha médica + cartilla y la firma de imagen
 * + foto, más la pantalla final "completado, pendiente de validación".
 */
export function PasoPlaceholder({ texto, onBack, onNext }: Props) {
  const t = useTranslations('alta')
  return (
    <div className="space-y-4">
      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        {texto}
      </div>
      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        {onNext && (
          <Button type="button" onClick={onNext}>
            {t('wizard.siguiente')}
          </Button>
        )}
      </div>
    </div>
  )
}
