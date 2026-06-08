import { ArrowLeftIcon, FileSignatureIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import {
  EstadoDocBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { SeccionMedicacion } from '@/features/autorizaciones/components/SeccionMedicacion'
import { getAutorizacionesAdmin } from '@/features/autorizaciones/queries/get-autorizaciones-admin'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ historico?: string }>
}

const BASE = '/teacher/autorizaciones'

/**
 * Autorizaciones de la profe: recogidas y medicación de los niños de SU aula (RLS).
 * La medicación muestra su actividad en la lista (dosis dadas/pendientes) y permite
 * archivar las terminadas + consultar el histórico. No gestiona catálogo ni envíos.
 */
export default async function TeacherAutorizacionesPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const soloHistorico = (await searchParams).historico === '1'
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  if (soloHistorico) {
    return (
      <div className="space-y-6">
        <Link
          href={`/${locale}${BASE}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
        <SeccionMedicacion locale={locale} baseHref={BASE} puedeArchivar soloHistorico />
      </div>
    )
  }

  const instancias = await getAutorizacionesAdmin()
  const recogidas = instancias.filter((a) => a.tipo === 'recogida')

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <FileSignatureIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('teacher.intro')}</p>
      </header>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground flex items-center gap-2">
            <UsersIcon className="size-5" />
            {t('teacher.recogidas_titulo')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('teacher.recogidas_desc')}</p>
        </div>
        {recogidas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('teacher.recogidas_vacio')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {recogidas.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/${locale}${BASE}/${a.id}`}
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
      </section>

      <SeccionMedicacion locale={locale} baseHref={BASE} puedeArchivar />
    </div>
  )
}
