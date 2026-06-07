import { FileSignatureIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CrearAutorizacionDialog } from '@/features/autorizaciones/components/CrearAutorizacionDialog'
import { CrearPlantillaDialog } from '@/features/autorizaciones/components/CrearPlantillaDialog'
import { EnviarAutorizacionDialog } from '@/features/autorizaciones/components/EnviarAutorizacionDialog'
import {
  EstadoDocBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { getAutorizacionesAdmin } from '@/features/autorizaciones/queries/get-autorizaciones-admin'
import { getEventosExcursion } from '@/features/autorizaciones/queries/get-eventos-excursion'
import { getPlantillasCatalogo } from '@/features/autorizaciones/queries/get-plantillas-catalogo'
import { getPlantillasParaEnviar } from '@/features/autorizaciones/queries/get-plantillas-para-enviar'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getAulasParaRecordatorios } from '@/features/recordatorios/queries/get-aulas-para-recordatorios'
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
  const [instancias, eventos, plantillas, plantillasEnviar, ninos, aulas] = await Promise.all([
    getAutorizacionesAdmin(),
    getEventosExcursion(centroId),
    esAdmin ? getPlantillasCatalogo() : Promise.resolve([]),
    esAdmin ? getPlantillasParaEnviar() : Promise.resolve([]),
    esAdmin ? getNinosParaRecordatorios() : Promise.resolve([]),
    esAdmin ? getAulasParaRecordatorios('admin', centroId) : Promise.resolve([]),
  ])

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <FileSignatureIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('admin_intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {esAdmin && <CrearPlantillaDialog />}
          {esAdmin && (
            <EnviarAutorizacionDialog plantillas={plantillasEnviar} ninos={ninos} aulas={aulas} />
          )}
          {/* salida = bespoke por evento (no usa catálogo); solo con excursiones. */}
          {eventos.length > 0 && <CrearAutorizacionDialog eventos={eventos} />}
        </div>
      </header>

      <p className="text-muted-foreground text-xs">{t('aviso_legal')}</p>

      {/* Catálogo de formatos (plantillas durables) — solo admin. */}
      {esAdmin && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-h2 text-foreground">{t('catalogo.titulo')}</h2>
            <p className="text-muted-foreground text-sm">{t('catalogo.descripcion')}</p>
          </div>
          {plantillas.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('catalogo.vacio')}</p>
          ) : (
            <ul className="divide-border divide-y rounded-lg border">
              {plantillas.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/${locale}/admin/autorizaciones/${p.id}`}
                    className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{p.titulo}</span>
                      <TipoAutorizacionBadge tipo={p.tipo} />
                    </span>
                    <EstadoDocBadge estado={p.estado} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Instancias firmables (enviadas + salidas + B2/legacy). */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground">{t('instancias.titulo')}</h2>
          <p className="text-muted-foreground text-sm">{t('instancias.descripcion')}</p>
        </div>
        {instancias.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('lista.vacia_admin')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {instancias.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/${locale}/admin/autorizaciones/${a.id}`}
                  className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{a.titulo}</span>
                    <TipoAutorizacionBadge tipo={a.tipo} />
                    {a.ambito && (
                      <span className="text-muted-foreground text-xs">
                        {t(`ambito.${a.ambito}`)}
                      </span>
                    )}
                  </span>
                  <EstadoDocBadge estado={a.estado} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
