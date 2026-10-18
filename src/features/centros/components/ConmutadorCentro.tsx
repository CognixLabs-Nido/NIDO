'use client'

import { useTranslations } from 'next-intl'

import { SelectorCentro, type OpcionCentro } from './SelectorCentro'

interface Props {
  locale: string
  centros: ReadonlyArray<OpcionCentro>
  actual: string
}

/**
 * Conmutador de centro en la barra lateral (multicentro · Fase 1). El layout solo lo monta
 * cuando el usuario tiene MÁS de un centro; con uno no existe. Cambiar de centro lleva al
 * reparto por rol (`select-role`), porque el rol puede ser otro en el centro nuevo.
 */
export function ConmutadorCentro({ locale, centros, actual }: Props) {
  const t = useTranslations('centros.conmutador')
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
        {t('cambiar')}
      </summary>
      <div className="pt-2" aria-label={t('etiqueta')}>
        <SelectorCentro locale={locale} centros={centros} actual={actual} variante="compacta" />
      </div>
    </details>
  )
}
