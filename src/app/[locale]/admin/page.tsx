import { BookOpenIcon, BabyIcon, UsersIcon, CalendarDaysIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { cn } from '@/lib/utils'

type StatTone = 'primary' | 'accent-warm' | 'success' | 'info'

const toneClasses: Record<StatTone, string> = {
  primary: 'bg-primary-100 text-primary-700',
  'accent-warm': 'bg-accent-warm-100 text-accent-warm-700',
  success: 'bg-success-100 text-success-700',
  info: 'bg-info-100 text-info-700',
}

export default async function AdminDashboard() {
  const t = await getTranslations('admin.dashboard')
  const supabase = await createClient()
  const centroId = (await getCentroActualId())!
  const user = await getCurrentUser()

  const [aulasResp, ninosResp, usuariosResp, cursoActivo] = await Promise.all([
    supabase
      .from('aulas')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centroId)
      .is('deleted_at', null),
    supabase
      .from('ninos')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centroId)
      .is('deleted_at', null),
    supabase
      .from('roles_usuario')
      .select('usuario_id', { count: 'exact', head: true })
      .eq('centro_id', centroId)
      .is('deleted_at', null),
    getCursoActivo(centroId),
  ])

  const aulasCount = aulasResp.count ?? 0
  const ninosCount = ninosResp.count ?? 0
  const usuariosCount = usuariosResp.count ?? 0
  const firstName = (user?.nombreCompleto ?? '').split(' ')[0]

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">
          {firstName ? t('greeting', { nombre: firstName }) : t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <section
        aria-label={t('title')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Stat
          icon={CalendarDaysIcon}
          tone="info"
          label={t('stats.curso_activo')}
          value={cursoActivo?.nombre ?? t('stats.sin_curso')}
        />
        <Stat icon={BookOpenIcon} tone="accent-warm" label={t('stats.aulas')} value={aulasCount} />
        <Stat icon={BabyIcon} tone="primary" label={t('stats.ninos_activos')} value={ninosCount} />
        <Stat
          icon={UsersIcon}
          tone="success"
          label={t('stats.usuarios_activos')}
          value={usuariosCount}
        />
      </section>
    </div>
  )
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon
  tone: StatTone
  label: string
  value: string | number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
            toneClasses[tone]
          )}
        >
          <Icon className="size-6" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {label}
          </div>
          <div className="text-foreground truncate text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}
