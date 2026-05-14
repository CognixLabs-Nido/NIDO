import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function TeacherDashboard({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('teacher.dashboard')
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id

  type AulaRow = { id: string; nombre: string; cohorte_anos_nacimiento: number[] }
  let aulas: AulaRow[] = []
  if (userId) {
    const { data } = await supabase
      .from('profes_aulas')
      .select('aulas(id, nombre, cohorte_anos_nacimiento)')
      .eq('profe_id', userId)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    aulas = (data ?? [])
      .map((r): AulaRow | null => {
        const raw = r.aulas as AulaRow | AulaRow[] | null
        if (!raw) return null
        if (Array.isArray(raw)) return raw[0] ?? null
        return raw
      })
      .filter((a): a is AulaRow => a !== null)
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      {aulas.length === 0 ? (
        <p className="text-muted-foreground mt-6">{t('ningun_aula')}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {aulas.map((a) => (
            <Link key={a.id} href={`/${locale}/teacher/aula/${a.id}`}>
              <Card className="cursor-pointer transition hover:shadow-md">
                <CardHeader>
                  <CardTitle>{a.nombre}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-xs">
                    {t('cohorte_label')}: {a.cohorte_anos_nacimiento.join(', ')}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
