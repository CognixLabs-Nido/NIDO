import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { VerDatosBloqueados } from '@/features/datos-bloqueados/components/VerDatosBloqueados'
import { getSujetosBloqueados } from '@/features/datos-bloqueados/queries/get-datos-bloqueados'

interface PageProps {
  params: Promise<{ locale: string; tipo: string; id: string }>
}

/**
 * Un sujeto con algo bloqueado. La página no enseña nada bloqueado: lo pide el formulario, con el
 * motivo, a `ver_datos_bloqueados`, que es quien decide y deja la fila.
 */
export default async function DatoBloqueadoPage({ params }: PageProps) {
  const { locale, tipo, id } = await params
  const t = await getTranslations('datos_bloqueados')
  const { centroId, esResponsable, esSuperusuario } = await requireContextoCentro(locale)
  // Solo la admin del centro (`privado.es_titular`): el superusuario tampoco (PR-B1).
  if (!esResponsable || esSuperusuario) redirect(`/${locale}/forbidden`)
  if (tipo !== 'nino' && tipo !== 'usuario') notFound()

  const sujetos = await getSujetosBloqueados(centroId)
  if (sujetos.tipo === 'no_autorizado') redirect(`/${locale}/forbidden`)
  if (sujetos.tipo === 'error') throw new Error('sujetos_bloqueados falló')
  const sujeto = sujetos.filas.find((s) => s.sujeto_tipo === tipo && s.sujeto_id === id)
  if (!sujeto) notFound()

  const etiqueta = [
    tipo === 'nino' ? t('sujeto_nino') : t('sujeto_usuario'),
    sujeto.familia ? t('familia', { familia: sujeto.familia }) : null,
    sujeto.aula ? t('matricula', { aula: sujeto.aula, curso: sujeto.curso ?? '' }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/${locale}/admin/datos-bloqueados`}
          className="text-muted-foreground text-xs underline-offset-4 hover:underline"
        >
          {t('volver')}
        </Link>
        <h1 className="text-h1 text-foreground">{t('detalle_titulo')}</h1>
        <p className="text-muted-foreground text-sm">{etiqueta}</p>
      </header>
      <VerDatosBloqueados centroId={centroId} sujetoTipo={tipo} sujetoId={id} sujeto={etiqueta} />
    </div>
  )
}
