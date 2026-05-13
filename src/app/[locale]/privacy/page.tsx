import { useTranslations } from 'next-intl'

export default function PrivacyPage() {
  return <Content />
}

function Content() {
  const t = useTranslations('legal.privacy')
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-4 text-3xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('placeholder')}</p>
    </main>
  )
}
