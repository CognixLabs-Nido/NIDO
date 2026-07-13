import {
  ArchiveIcon,
  BabyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  UserIcon,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { EditarEtiquetaDialog } from '@/features/familias/components/EditarEtiquetaDialog'
import { EditarTutorDialog } from '@/features/familias/components/EditarTutorDialog'
import {
  getFamiliaDetalle,
  type TutorDetalle,
} from '@/features/familias/queries/get-familia-detalle'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

/** F-6a — ficha de familia de Dirección: etiqueta + estado, tutores y hijos. Solo-lectura si archivada. */
export default async function FichaFamiliaPage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('admin.familias')
  const centroId = (await getCentroActualId())!
  const familia = await getFamiliaDetalle(id, centroId)
  if (!familia) notFound()
  const archivada = familia.estado === 'inactiva'

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/admin/familias`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {t('title')}
      </Link>

      <header className="bg-card border-border/60 flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-md">
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 text-foreground truncate">{familia.etiqueta ?? '—'}</h1>
          <p className="text-muted-foreground text-sm">
            {t('resumen', { hijos: familia.hijos.length, tutores: familia.tutores.length })}
          </p>
        </div>
        {archivada ? (
          <Badge variant="warm">{t('estado.archivada')}</Badge>
        ) : (
          <Badge variant="success">{t('estado.activa')}</Badge>
        )}
        {/* Editar la etiqueta: solo en familia activa (solo-lectura si archivada). */}
        {!archivada && (
          <EditarEtiquetaDialog
            familiaId={familia.id}
            etiquetaActual={familia.etiqueta}
            trigger={
              <Button variant="outline" size="sm">
                <PencilIcon className="size-4" />
                {t('editar_etiqueta.abrir')}
              </Button>
            }
          />
        )}
      </header>

      {archivada && (
        <div className="border-warm-300 bg-warm-100 text-warm-800 flex items-center gap-2 rounded-2xl border-l-4 px-4 py-3 text-sm">
          <ArchiveIcon className="size-4 shrink-0" />
          <span className="font-semibold">{t('archivada_banner')}</span>
        </div>
      )}

      {/* Tutores */}
      <section className="space-y-3">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <UserIcon className="text-muted-foreground size-4" />
          {t('tutores.titulo')}
        </h2>
        {familia.tutores.length === 0 ? (
          <Card>
            <EmptyState icon={<UserIcon strokeWidth={1.75} />} title={t('tutores.vacio')} />
          </Card>
        ) : (
          familia.tutores.map((tutor) => (
            <TutorCard key={tutor.id} tutor={tutor} archivada={archivada} t={t} />
          ))
        )}
      </section>

      {/* Hijos */}
      <section className="space-y-3">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <BabyIcon className="text-muted-foreground size-4" />
          {t('hijos.titulo')}
        </h2>
        {familia.hijos.length === 0 ? (
          <Card>
            <EmptyState icon={<BabyIcon strokeWidth={1.75} />} title={t('hijos.vacio')} />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-border/60 divide-y">
              {familia.hijos.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`/${locale}/admin/ninos/${h.id}`}
                    className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <span className="text-foreground font-medium">
                      {h.nombre}
                      {h.apellidos ? ` ${h.apellidos}` : ''}
                    </span>
                    {h.estado === 'archivado' ? (
                      <Badge variant="warm">{t('hijos.archivado')}</Badge>
                    ) : (
                      <Badge variant="success">{t('hijos.activo')}</Badge>
                    )}
                    {h.aula_nombre && <Badge variant="secondary">{h.aula_nombre}</Badge>}
                    <ChevronRightIcon className="text-muted-foreground ml-auto size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}

function TutorCard({
  tutor,
  archivada,
  t,
}: {
  tutor: TutorDetalle
  archivada: boolean
  t: Awaited<ReturnType<typeof getTranslations>>
}) {
  const direccion = [
    [tutor.direccion_calle, tutor.direccion_numero].filter(Boolean).join(' '),
    tutor.direccion_cp,
    tutor.direccion_ciudad,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Card>
      <CardContent className="space-y-2 pt-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground font-medium">{tutor.nombre_completo ?? '—'}</span>
          <Badge variant="info">
            {t(tutor.rol_familia === 'titular' ? 'roles.titular' : 'roles.segundo_tutor')}
          </Badge>
          {!tutor.tiene_cuenta && <Badge variant="warm">{t('sin_cuenta')}</Badge>}
          {!archivada && (
            <EditarTutorDialog
              tutor={tutor}
              trigger={
                <Button variant="outline" size="sm" className="ml-auto">
                  <PencilIcon className="size-4" />
                  {t('editar_tutor.abrir')}
                </Button>
              }
            />
          )}
        </div>
        <Row k={t('fields.email')} v={tutor.email ?? '—'} />
        <Row k={t('fields.direccion')} v={direccion || '—'} />
        {tutor.dni_documento_path && <Row k={t('fields.dni')} v={t('dni_subido')} />}
      </CardContent>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-muted-foreground w-40 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
