import 'server-only'

import { ShieldAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'

import { salirDelCentro } from '../actions/salir-centro'
import type { ContextoCentro } from '../contexto/get-contexto-centro'
import { getNombresCentros } from '../queries/get-nombres-centros'

interface Props {
  contexto: ContextoCentro
  locale: string
}

/**
 * Banda de aviso mientras el superusuario está dentro de un centro (Fase 3, ADR-0061): está
 * viendo los datos de un centro cliente con permisos totales, y nada más en la pantalla se lo
 * recuerda, sobre todo al entrar en varios centros seguidos. Lleva el nombre del centro y el
 * botón de salir (`salirDelCentro`). Para cualquier otro usuario no pinta nada ni consulta.
 *
 * La montan todos los layouts que leen el centro activo; lo vigila
 * `src/test/guards/aviso-superusuario.test.ts`.
 */
export async function AvisoSuperusuario({ contexto, locale }: Props) {
  if (!contexto.esSuperusuario) return null
  const t = await getTranslations('centros.superusuario')
  const tElegir = await getTranslations('centros.elegir')
  const nombres = await getNombresCentros([contexto.centroId])
  const centro = nombres.get(contexto.centroId) ?? tElegir('sin_nombre')

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 md:px-8 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        <span className="font-semibold">{t('etiqueta')}</span>
        <span>{t('aviso', { centro })}</span>
      </p>
      <form action={salirDelCentro.bind(null, locale)}>
        <Button type="submit" size="sm" variant="outline">
          {t('salir')}
        </Button>
      </form>
    </div>
  )
}
