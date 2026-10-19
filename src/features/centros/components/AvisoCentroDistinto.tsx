import 'server-only'

import { Building2Icon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { getEstadoCentro } from '../contexto/get-contexto-centro'
import { getNombresCentros } from '../queries/get-nombres-centros'

interface Props {
  /** Centro del registro que enseña la página (el del aula o el del niño). */
  centroRegistroId: string
}

/**
 * Aviso en la cabecera cuando la página es de un centro distinto del activo (decisión de Jose,
 * multicentro · Fase 1): la página se muestra igual, el enlace funciona siempre, pero se dice en
 * qué centro estás, para no apuntar algo en el aula equivocada creyendo que estás en el otro.
 *
 * Solo para quien tiene más de un centro: con uno, el registro es siempre del suyo y no se pinta
 * nada (ni consulta nombres).
 */
export async function AvisoCentroDistinto({ centroRegistroId }: Props) {
  const estado = await getEstadoCentro()
  const centros =
    estado.tipo === 'activo'
      ? estado.contexto.centros
      : estado.tipo === 'elegir'
        ? estado.centros
        : []
  if (centros.length < 2) return null

  const activoId = estado.tipo === 'activo' ? estado.contexto.centroId : null
  if (activoId === centroRegistroId) return null

  const t = await getTranslations('centros')
  const nombres = await getNombresCentros(
    activoId ? [centroRegistroId, activoId] : [centroRegistroId]
  )
  const nombre = (id: string) => nombres.get(id) ?? t('elegir.sin_nombre')

  return (
    <p
      role="status"
      className="bg-muted text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <Building2Icon className="size-4 shrink-0" aria-hidden />
      {activoId
        ? t('aviso.otro_centro', { centro: nombre(centroRegistroId), activo: nombre(activoId) })
        : t('aviso.viendo', { centro: nombre(centroRegistroId) })}
    </p>
  )
}
