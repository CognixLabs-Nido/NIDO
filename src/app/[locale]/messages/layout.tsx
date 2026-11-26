import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AgendaBadge } from '@/features/agenda/components/AgendaBadge'
import { contarInvitacionesPendientes } from '@/features/agenda/queries/contar-invitaciones-pendientes'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { AvisoSuperusuario } from '@/features/centros/components/AvisoSuperusuario'
import { ConmutadorCentroServidor } from '@/features/centros/components/ConmutadorCentroServidor'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { MessagingBadge } from '@/features/messaging/components/MessagingBadge'
import { countNoLeidos } from '@/features/messaging/queries/count-no-leidos'
import { RecordatoriosBadge } from '@/features/recordatorios/components/RecordatoriosBadge'
import { contarRecordatoriosPendientes } from '@/features/recordatorios/queries/contar-pendientes'
import { SidebarNav } from '@/shared/components/SidebarNav'
import { oNoLeido } from '@/shared/lib/en-seccion'
import { buildSidebarItems } from '@/shared/lib/sidebar-items'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * Layout transversal de mensajería. Es accesible para los 4 roles
 * (admin/profe/tutor_legal/autorizado). La sidebar muestra los items
 * del rol del usuario para que la navegación sea coherente cuando
 * vuelve a /admin, /teacher o /family desde /messages.
 *
 * El servicio role no entra aquí (es solo backend).
 */
// Censo C (2026-11-25): lo que lee este layout va POR SECCIÓN (`oNoLeido`): un contador o el logo que
// no se pudieron leer lo dicen en su sitio, y el área sigue. El error.tsx de esta sección no captura lo de su
// propio layout: sin esto, un contador de no leídos tiraba el área entera, con el pase de lista dentro.
// El contexto del centro (el rol) sí sigue lanzando: sin él no se sabe qué puede ver quien entra.
export default async function MessagesLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const tNav = await getTranslations('admin.nav') // 'perfil' es común a los tres roles
  const tRoles = await getTranslations('auth.select_role.roles')

  const contexto = await requireContextoCentro(locale)
  const centroId = contexto.centroId

  const rolRaw = contexto.rol
  if (
    !rolRaw ||
    (rolRaw !== 'admin' &&
      rolRaw !== 'profe' &&
      rolRaw !== 'tutor_legal' &&
      rolRaw !== 'autorizado')
  ) {
    redirect(`/${locale}/forbidden`)
  }
  const rol = rolRaw as 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

  const user = await oNoLeido(getCurrentUser(), 'layout: usuario')
  const centroLogo = await oNoLeido(getCentroLogo(centroId), 'layout: logo')
  const unread = (await oNoLeido(countNoLeidos(centroId), 'layout: no leídos'))?.total ?? null
  const recordatoriosPendientes = await oNoLeido(
    contarRecordatoriosPendientes(centroId),
    'layout: recordatorios'
  )
  const invitacionesPendientes = await oNoLeido(
    contarInvitacionesPendientes(centroId),
    'layout: citas'
  )

  const items = await buildSidebarItems(
    rol,
    locale,
    contexto,
    <MessagingBadge initialTotal={unread} centroId={centroId} />,
    <RecordatoriosBadge initialTotal={recordatoriosPendientes} centroId={centroId} />,
    <AgendaBadge initialTotal={invitacionesPendientes} />
  )

  const roleLabel =
    rol === 'admin'
      ? tRoles('admin')
      : rol === 'profe'
        ? tRoles('profe')
        : rol === 'autorizado'
          ? tRoles('autorizado')
          : tRoles('tutor_legal')

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? tNav('perfil'),
          roleLabel,
        }}
        centroLogo={centroLogo ? { url: centroLogo.logoUrl, name: centroLogo.nombre } : null}
        conmutadorCentro={<ConmutadorCentroServidor contexto={contexto} locale={locale} />}
        profileHref={`/${locale}/profile`}
        profileLabel={tNav('perfil')}
        ariaLabel={tNav('aria_label')}
      />
      <main className="min-w-0 flex-1">
        <AvisoSuperusuario contexto={contexto} locale={locale} />
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
