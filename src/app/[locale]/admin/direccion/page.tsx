import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { AccionesDirectora } from '@/features/direccion/components/AccionesDirectora'
import { CancelarInvitacionDirectora } from '@/features/direccion/components/CancelarInvitacionDirectora'
import { DejarDireccion } from '@/features/direccion/components/DejarDireccion'
import { InvitarDirectoraDialog } from '@/features/direccion/components/InvitarDirectoraDialog'
import {
  getDireccionDelCentro,
  getInvitacionesDirectora,
} from '@/features/direccion/queries/get-direccion'
import { localeIntl } from '@/shared/lib/locale-intl'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Quién dirige el centro (PR 4 del modelo de roles), solo para la admin: invitar a una directora,
 * darla de baja, traspasarle la administración y dejar la dirección. En el resto de la app las dos
 * son «Dirección»; aquí se dice quién administra, porque es lo que se gestiona.
 */
export default async function DireccionPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.direccion')
  const { centroId, esResponsable } = await requireContextoCentro(locale)
  if (!esResponsable) redirect(`/${locale}/forbidden`)

  const [miembros, invitaciones, yo] = await Promise.all([
    getDireccionDelCentro(centroId),
    getInvitacionesDirectora(centroId),
    getCurrentUser(),
  ])
  // Traspasa solo quien tiene la fila de admin: el superusuario gestiona, pero no traspasa.
  const soyLaAdmin = !!miembros?.some((m) => m.rol === 'admin' && m.usuarioId === yo?.id)
  const fecha = new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'medium' })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('descripcion')}</p>
        </div>
        <InvitarDirectoraDialog centroId={centroId} />
      </header>

      {miembros === null ? (
        <Card className="text-muted-foreground p-6 text-sm">{t('error_lectura')}</Card>
      ) : (
        <Card className="divide-y">
          {miembros.map((m) => (
            <div
              key={m.usuarioId}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground font-medium">{m.nombre}</span>
                {m.rol === 'admin' && <Badge variant="secondary">{t('administra')}</Badge>}
                {m.usuarioId === yo?.id && <Badge variant="outline">{t('tu')}</Badge>}
              </div>
              {m.usuarioId === yo?.id ? (
                <DejarDireccion
                  centroId={centroId}
                  locale={locale}
                  administra={m.rol === 'admin'}
                />
              ) : m.rol === 'directora' ? (
                <AccionesDirectora
                  centroId={centroId}
                  usuarioId={m.usuarioId}
                  nombre={m.nombre}
                  puedeTraspasar={soyLaAdmin}
                />
              ) : null}
            </div>
          ))}
          {!miembros.some((m) => m.rol === 'directora') && (
            <p className="text-muted-foreground p-4 text-sm">{t('sin_directoras')}</p>
          )}
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-h3">{t('pendientes.title')}</h2>
        {invitaciones === null ? (
          <Card className="text-muted-foreground p-6 text-sm">{t('error_lectura')}</Card>
        ) : invitaciones.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('pendientes.vacio')}</p>
        ) : (
          <Card className="divide-y">
            {invitaciones.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-0.5">
                  <p className="text-foreground text-sm font-medium">{i.email}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('pendientes.caduca', { fecha: fecha.format(new Date(i.expiresAt)) })}
                  </p>
                </div>
                <CancelarInvitacionDirectora
                  centroId={centroId}
                  invitacionId={i.id}
                  email={i.email}
                />
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  )
}
