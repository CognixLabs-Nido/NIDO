import { BabyIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { estadoAltaFamilia } from '@/features/alta/lib/gate-familia'
import { ambitoFamiliar } from '@/features/centros/contexto/ambito-familiar'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { ResumenSemanaWidget } from '@/features/inicio/components/ResumenSemanaWidget'
import { AvisosInicio } from '@/features/notificaciones/components/AvisosInicio'
import { getAvisosInicio } from '@/features/notificaciones/queries/get-avisos-inicio'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function FamilyDashboard({ params }: PageProps) {
  const { locale } = await params

  // El gate del alta (P3c, per-hijo) vive en `family/layout.tsx`. Aquí solo se marca el
  // hijo con el alta en curso: su tarjeta lleva al asistente en vez de a la ficha.
  const t = await getTranslations('family.dashboard')
  const tAlta = await getTranslations('family.alta_en_curso')
  const { centroId } = await requireContextoCentro(locale)
  const { ninosEnAlta } = await estadoAltaFamilia(centroId)
  // Solo los hijos del centro activo (multicentro · Fase 2).
  const { hijos: ninos } = await ambitoFamiliar(centroId)

  const avisos = await getAvisosInicio('tutor_legal', centroId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <AvisosInicio avisos={avisos} rol="tutor_legal" locale={locale} />
      {centroId && (
        <ResumenSemanaWidget
          centroId={centroId}
          agendaHref={`/${locale}/agenda`}
          calendarioHref={`/${locale}/family/calendario`}
        />
      )}
      {ninos.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BabyIcon strokeWidth={1.75} />}
              title={t('ningun_nino')}
              description={t('ningun_nino_descripcion')}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ninos.map((n) => {
            const initials =
              (n.nombre.charAt(0) + ((n.apellidos ?? '').charAt(0) || '')).toUpperCase() || '?'
            const enAlta = ninosEnAlta.includes(n.id)
            return (
              <Link
                key={n.id}
                href={enAlta ? `/${locale}/alta/${n.id}` : `/${locale}/family/nino/${n.id}`}
                data-testid={enAlta ? 'nino-alta-en-curso' : undefined}
                className="focus-visible:ring-ring rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="hover:border-primary-200 h-full transition hover:shadow-lg">
                  <CardContent className="flex items-center gap-4">
                    <div className="bg-primary-100 text-primary-700 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-foreground truncate text-lg font-semibold">
                        {n.nombre}
                        {n.apellidos ? ` ${n.apellidos}` : ''}
                      </h2>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {enAlta
                          ? tAlta('etiqueta')
                          : n.apellidos
                            ? t('ver_ficha')
                            : t('datos_pendientes')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
