import 'server-only'

import { getTranslations } from 'next-intl/server'

import type { ContextoCentro } from '../contexto/get-contexto-centro'
import { getNombresCentros } from '../queries/get-nombres-centros'

import { ConmutadorCentro } from './ConmutadorCentro'
import { LimiteSeccion } from '@/shared/components/LimiteSeccion'

interface Props {
  contexto: ContextoCentro
  locale: string
}

/**
 * Pone nombre a los centros y monta el conmutador, solo si el usuario tiene más de uno. Con un
 * centro no pinta nada (ni consulta): quien tiene uno no ve nunca el conmutador.
 */
async function ConmutadorCentroServidorContenido({ contexto, locale }: Props) {
  if (contexto.centros.length < 2) return null
  const t = await getTranslations('centros.elegir')
  const nombres = await getNombresCentros(contexto.centros.map((c) => c.centroId))
  const centros = contexto.centros.map((c) => ({
    centroId: c.centroId,
    nombre: nombres.get(c.centroId) ?? t('sin_nombre'),
  }))
  return <ConmutadorCentro locale={locale} centros={centros} actual={contexto.centroId} />
}

/**
 * Una SECCIÓN (censo C, 2026-11-25): si su lectura falla, esta parte dice «no se ha podido leer» y el
 * resto de la pantalla sigue (`LimiteSeccion`). El contenido es `ConmutadorCentroServidorContenido`.
 */
export function ConmutadorCentroServidor(props: Props) {
  return (
    <LimiteSeccion>
      <ConmutadorCentroServidorContenido {...props} />
    </LimiteSeccion>
  )
}
