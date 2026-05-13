import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function AdminLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const t = await getTranslations('admin.nav')
  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <nav
        className="border-border mb-6 flex flex-wrap items-center gap-3 border-b pb-3 text-sm"
        aria-label={t('aria_label')}
      >
        <Link href={`/${locale}/admin`} className="hover:underline">
          {t('dashboard')}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/${locale}/admin/centro`} className="hover:underline">
          {t('centro')}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/${locale}/admin/cursos`} className="hover:underline">
          {t('cursos')}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/${locale}/admin/aulas`} className="hover:underline">
          {t('aulas')}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/${locale}/admin/ninos`} className="hover:underline">
          {t('ninos')}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/${locale}/admin/audit`} className="hover:underline">
          {t('audit')}
        </Link>
        <span className="text-muted-foreground ml-auto text-xs">
          <Link href={`/${locale}/profile`} className="hover:underline">
            {t('perfil')}
          </Link>
        </span>
      </nav>
      {children}
    </div>
  )
}
