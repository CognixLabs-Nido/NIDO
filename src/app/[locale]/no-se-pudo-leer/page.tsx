import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { RefreshCwIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Censo C (decisión de Jose del 2026-11-25): lo que enseña el proxy cuando no ha podido leer los roles
 * de quien entra (antes, `/forbidden`: «no tienes acceso» a quien sí lo tiene). La sirve el proxy por
 * REWRITE, así que la dirección sigue siendo la pedida y recargar es reintentar.
 *
 * ES PÚBLICA, y por eso no revela NADA: el mismo texto para todo el mundo, sin leer la sesión, el
 * usuario, sus roles ni el centro, y sin dar acceso a ninguna parte (solo un enlace al inicio, que
 * pasa por el proxy como cualquier otro). «Con eso una página pública no aporta superficie.»
 */
export default async function NoSePudoLeerPage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('auth.no_se_pudo_leer')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg" data-testid="no-se-pudo-leer-proxy">
        <CardHeader>
          <div className="bg-coral-100 text-coral-700 mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full">
            <RefreshCwIcon className="size-6" />
          </div>
          <CardTitle className="text-center">{t('title')}</CardTitle>
          <CardDescription className="text-center">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={`/${locale}`}
            className={buttonVariants({ className: 'h-11 w-full text-base' })}
          >
            {t('back_to_home')}
          </Link>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
