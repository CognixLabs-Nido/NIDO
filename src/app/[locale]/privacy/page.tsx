import { useTranslations } from 'next-intl'

import { LegalShell } from '@/shared/components/LegalShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('legal.privacy')
  return (
    <LegalShell locale={locale} title={t('title')}>
      <p className="text-muted-foreground">{t('placeholder')}</p>
    </LegalShell>
  )
}
