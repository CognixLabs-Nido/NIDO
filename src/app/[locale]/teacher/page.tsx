import { BookOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { ResumenSemanaWidget } from '@/features/inicio/components/ResumenSemanaWidget'
import { AvisosInicio } from '@/features/notificaciones/components/AvisosInicio'
import { getAvisosInicio } from '@/features/notificaciones/queries/get-avisos-inicio'
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
  const aulas: AulaRow[] = []
  if (userId) {
    // F11-H: la asignación es por (aula, curso) y el tramo de edad vive en aulas_curso.
    const { data } = await supabase
      .from('profes_aulas')
      .select('aula_id, curso_academico_id, aula:aulas!inner(id, nombre, deleted_at)')
      .eq('profe_id', userId)
      .is('fecha_fin', null)
      .is('deleted_at', null)

    const activos = (
      (data ?? []) as unknown as Array<{
        aula_id: string
        curso_academico_id: string
        aula: { id: string; nombre: string; deleted_at: string | null } | null
      }>
    ).filter((r) => r.aula && r.aula.deleted_at === null)

    const aulaIds = activos.map((r) => r.aula_id)
    const tramoPorAulaCurso = new Map<string, number[]>()
    if (aulaIds.length > 0) {
      const { data: configs } = await supabase
        .from('aulas_curso')
        .select('aula_id, curso_academico_id, tramo_edad')
        .in('aula_id', aulaIds)
      for (const c of (configs ?? []) as Array<{
        aula_id: string
        curso_academico_id: string
        tramo_edad: number[]
      }>) {
        tramoPorAulaCurso.set(`${c.aula_id}:${c.curso_academico_id}`, c.tramo_edad)
      }
    }

    const seen = new Set<string>()
    for (const r of activos) {
      if (!r.aula || seen.has(r.aula_id)) continue
      seen.add(r.aula_id)
      aulas.push({
        id: r.aula.id,
        nombre: r.aula.nombre,
        cohorte_anos_nacimiento:
          tramoPorAulaCurso.get(`${r.aula_id}:${r.curso_academico_id}`) ?? [],
      })
    }
  }

  const avisos = await getAvisosInicio('profe')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <AvisosInicio avisos={avisos} rol="profe" locale={locale} />
      {centroId && (
        <ResumenSemanaWidget
          centroId={centroId}
          agendaHref={`/${locale}/agenda`}
          calendarioHref={`/${locale}/teacher/calendario`}
        />
      )}
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
