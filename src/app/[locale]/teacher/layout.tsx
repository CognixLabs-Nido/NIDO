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

// Censo C (2026-11-25): lo que lee este layout va POR SECCIÓN (`oNoLeido`): un contador o el logo que
// no se pudieron leer lo dicen en su sitio, y el área sigue. El error.tsx de esta sección no captura lo de su
// propio layout: sin esto, un contador de no leídos tiraba el área entera, con el pase de lista dentro.
// El contexto del centro (el rol) sí sigue lanzando: sin él no se sabe qué puede ver quien entra.
export default async function TeacherLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const t = await getTranslations('teacher.nav')
  const tRoles = await getTranslations('auth.select_role.roles')
  const contexto = await requireContextoCentro(locale)
  const centroId = contexto.centroId

  const rol = contexto.rol
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

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
    rol === 'admin' ? 'admin' : 'profe',
    locale,
    contexto,
    <MessagingBadge initialTotal={unread} centroId={centroId} />,
    <RecordatoriosBadge initialTotal={recordatoriosPendientes} centroId={centroId} />,
    <AgendaBadge initialTotal={invitacionesPendientes} />
  )

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? t('perfil'),
          roleLabel: tRoles('profe'),
        }}
        centroLogo={centroLogo ? { url: centroLogo.logoUrl, name: centroLogo.nombre } : null}
        conmutadorCentro={<ConmutadorCentroServidor contexto={contexto} locale={locale} />}
        profileHref={`/${locale}/profile`}
        profileLabel={t('perfil')}
        ariaLabel={t('aria_label')}
      />
      <main className="min-w-0 flex-1">
        <AvisoSuperusuario contexto={contexto} locale={locale} />
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
