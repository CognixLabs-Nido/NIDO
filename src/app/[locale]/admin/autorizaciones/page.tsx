import { ArrowLeftIcon, FileSignatureIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CrearPlantillaDialog } from '@/features/autorizaciones/components/CrearPlantillaDialog'
import { EnviarAutorizacionDialog } from '@/features/autorizaciones/components/EnviarAutorizacionDialog'
import {
  EstadoDocBadge,
  EstadoFirmaBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { SeccionMedicacion } from '@/features/autorizaciones/components/SeccionMedicacion'
import { getEventosExcursion } from '@/features/autorizaciones/queries/get-eventos-excursion'
import { getPlantillasCatalogo } from '@/features/autorizaciones/queries/get-plantillas-catalogo'
import { getPlantillasParaEnviar } from '@/features/autorizaciones/queries/get-plantillas-para-enviar'
import { getSeguimientoEnvios } from '@/features/autorizaciones/queries/get-seguimiento-envios'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getAulasParaRecordatorios } from '@/features/recordatorios/queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ historico?: string }>
}

const BASE = '/admin/autorizaciones'

export default async function AdminAutorizacionesPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const soloHistorico = (await searchParams).historico === '1'
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

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

  const [seguimiento, eventos, plantillas, plantillasEnviar, ninos, aulas] = await Promise.all([
    getSeguimientoEnvios(),
    getEventosExcursion(centroId),
    getPlantillasCatalogo(),
    getPlantillasParaEnviar(),
    getNinosParaRecordatorios(),
    getAulasParaRecordatorios('admin', centroId),
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
          {/* Dos acciones de siempre: «Nueva autorización» (crea un formato del
              catálogo o una excursión —evento existente o nuevo inline—) y
              «Enviar autorización» (manda un formato publicado a una audiencia). */}
          <CrearPlantillaDialog eventos={eventos} aulas={aulas} />
          <EnviarAutorizacionDialog plantillas={plantillasEnviar} ninos={ninos} aulas={aulas} />
        </div>
      </header>

      <p className="text-muted-foreground text-xs">{t('aviso_legal')}</p>

      {/* SEGUIMIENTO — pendientes de firma con el niño concreto (para recordar). */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground">{t('seguimiento.pendientes_titulo')}</h2>
          <p className="text-muted-foreground text-sm">{t('seguimiento.pendientes_desc')}</p>
        </div>
        {seguimiento.pendientes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('seguimiento.pendientes_vacio')}</p>
        ) : (
          <ul className="space-y-3">
            {seguimiento.pendientes.map((p) => (
              <li key={p.id} className="rounded-lg border p-4">
                <Link
                  href={`/${locale}/admin/autorizaciones/${p.id}`}
                  className="flex flex-wrap items-center gap-2 hover:underline"
                >
                  <span className="font-medium">{p.titulo}</span>
                  <TipoAutorizacionBadge tipo={p.tipo} />
                  <span className="text-muted-foreground text-xs">
                    {t('seguimiento.progreso', { firmados: p.firmados, total: p.totalNinos })}
                  </span>
                </Link>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {p.ninos.map((n) => (
                    <li
                      key={n.nino_id}
                      className="bg-muted/40 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <span>{n.nino_nombre}</span>
                      <EstadoFirmaBadge estado={n.estado} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* SEGUIMIENTO — últimas 10 enviadas/iniciadas. */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground">{t('seguimiento.ultimas_titulo')}</h2>
          <p className="text-muted-foreground text-sm">{t('seguimiento.ultimas_desc')}</p>
        </div>
        {seguimiento.ultimas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('seguimiento.ultimas_vacio')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {seguimiento.ultimas.map((a) => (
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

      {/* Medicación: actividad de cada pauta (dosis dadas/pendientes) + archivar. */}
      <SeccionMedicacion locale={locale} baseHref={BASE} puedeArchivar />

      {/* Catálogo de formatos (plantillas durables) — solo admin. El alta vive en
          el botón «Nueva autorización» de la cabecera. */}
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
    </div>
  )
}
