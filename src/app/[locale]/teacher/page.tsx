import { useTranslations } from 'next-intl'

export default function TeacherDashboardPlaceholder() {
  return <Content />
}

function Content() {
  const t = useTranslations('auth.dashboard')
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <p className="text-muted-foreground text-lg">{t('teacher_placeholder')}</p>
    </div>
  )
}
