import { FileTextIcon } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { DocumentoDialog } from '@/features/documentos-centro/components/DocumentoDialog'
import { DocumentosCentroLista } from '@/features/documentos-centro/components/DocumentosCentroLista'
import { FicherosSueltos } from '@/features/documentos-centro/components/FicherosSueltos'
import { getDocumentosAdmin } from '@/features/documentos-centro/queries/get-documentos-admin'
import { EmptyState } from '@/shared/components/EmptyState'

/**
 * Los documentos del centro (serie de altas, fase 3, 3c): el presupuesto, las normas y los que
 * defina el centro, con sus versiones. Solo la admin del centro (J1), como la base
 * (`privado.es_responsable`): una directora no tiene esta página.
 */
export default async function AdminDocumentosCentroPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('documentos_centro.pantalla')
  const { centroId, esResponsable } = await requireContextoCentro(locale)
  if (!esResponsable) redirect(`/${locale}/forbidden`)

  const pantalla = await getDocumentosAdmin(centroId)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <FileTextIcon className="text-primary-600 size-7" />
            {t('titulo')}
          </h1>
          <p className="text-muted-foreground max-w-prose text-sm">{t('intro')}</p>
        </div>
        {pantalla && <DocumentoDialog centroId={centroId} puedeCambiarDeCurso />}
      </header>
      {pantalla ? (
        <>
          <FicherosSueltos centroId={centroId} rutas={pantalla.lista.ficheros_sueltos} />
          <DocumentosCentroLista locale={locale} centroId={centroId} pantalla={pantalla} />
        </>
      ) : (
        <EmptyState icon={<FileTextIcon strokeWidth={1.75} />} title={t('error_carga')} />
      )}
    </div>
  )
}
