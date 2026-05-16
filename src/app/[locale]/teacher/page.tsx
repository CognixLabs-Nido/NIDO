import { BookOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProximosDiasCerradosWidget } from '@/features/calendario-centro/components/ProximosDiasCerradosWidget'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { EmptyState } from '@/shared/components/EmptyState'
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
  const centroId = await getCentroActualId()

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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      {centroId && <ProximosDiasCerradosWidget centroId={centroId} />}
      {aulas.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BookOpenIcon strokeWidth={1.75} />}
              title={t('ningun_aula')}
              description={t('ningun_aula_descripcion')}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {aulas.map((a) => (
            <Link
              key={a.id}
              href={`/${locale}/teacher/aula/${a.id}`}
              className="focus-visible:ring-ring rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Card className="hover:border-accent-warm-200 h-full transition hover:shadow-lg">
                <CardContent className="flex items-start gap-4">
                  <div className="bg-accent-warm-100 text-accent-warm-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                    <BookOpenIcon className="size-6" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-foreground text-lg font-semibold">{a.nombre}</h2>
                    <p className="text-muted-foreground mt-1 text-xs">{t('cohorte_label')}:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.cohorte_anos_nacimiento.map((y) => (
                        <Badge key={y} variant="warm">
                          {y}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
