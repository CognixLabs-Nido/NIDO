'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

interface Props {
  onClick: () => void
  /** Útil para tests. Permite distinguir el botón cuando hay varias
   *  conversaciones renderizadas (p.ej. en `ConversacionesSplitView`
   *  durante la transición). */
  testId?: string
}

/**
 * Botón circular flotante "ir al último mensaje", visible en el panel
 * de conversación cuando el usuario se ha alejado del fondo. Patrón
 * WhatsApp (F5.6-C). El componente padre decide cuándo montarlo (en
 * función de `mostrarBotonIrAlFondo` del hook `useScrollAlFondo`); aquí
 * solo nos ocupamos del render y del label i18n.
 *
 * Se posiciona `absolute` dentro del contenedor scrolleable (que debe
 * ser `relative`). Botón `<button type="button">` nativo — no usamos
 * el `<Button>` de shadcn para mantener consistencia con el caso del
 * composer (ver Bug 1 post-F5).
 */
export function IrAlFondoButton({ onClick, testId = 'ir-al-fondo-button' }: Props) {
  const t = useTranslations('messages.conversacion')
  const label = t('ir_al_ultimo')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'bg-background text-foreground hover:bg-muted absolute right-4 bottom-4 z-[1]',
        'inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2'
      )}
    >
      <ChevronDownIcon className="size-5" />
      <span className="sr-only">{label}</span>
    </button>
  )
}
