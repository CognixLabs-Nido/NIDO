import { FileSignatureIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CrearAutorizacionDialog } from '@/features/autorizaciones/components/CrearAutorizacionDialog'
import { CrearReglasDialog } from '@/features/autorizaciones/components/CrearReglasDialog'
import {
  EstadoDocBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { getAutorizacionesAdmin } from '@/features/autorizaciones/queries/get-autorizaciones-admin'
import { getEventosExcursion } from '@/features/autorizaciones/queries/get-eventos-excursion'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminAutorizacionesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin' && rol !== 'profe') redirect(`/${locale}/forbidden`)

  const esAdmin = rol === 'admin'
  const [autorizaciones, eventos, ninos] = await Promise.all([
    getAutorizacionesAdmin(),
    getEventosExcursion(centroId),
    esAdmin ? getNinosParaRecordatorios() : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <FileSignatureIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('admin_intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CrearAutorizacionDialog eventos={eventos} />
          {esAdmin && <CrearReglasDialog ninos={ninos} />}
        </div>
      </header>

      <p className="text-muted-foreground text-xs">{t('aviso_legal')}</p>

      {autorizaciones.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('lista.vacia_admin')}</p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {autorizaciones.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${locale}/admin/autorizaciones/${a.id}`}
                className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{a.titulo}</span>
                  <TipoAutorizacionBadge tipo={a.tipo} />
                </span>
                <EstadoDocBadge estado={a.estado} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
