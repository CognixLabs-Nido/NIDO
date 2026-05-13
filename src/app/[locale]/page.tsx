import { useTranslations } from 'next-intl'

export default function HomePage() {
  const t = useTranslations('common')

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t('appName')}
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Agenda digital para escuelas infantiles 0-3 años
        </p>
        <p className="rounded-full bg-zinc-200 px-4 py-1 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Fase 0 — Fundaciones
        </p>
      </main>
    </div>
  )
}
