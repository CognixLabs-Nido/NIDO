import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'

export default async function AdminDashboard() {
  const t = await getTranslations('admin.dashboard')
  const supabase = await createClient()
  const centroId = (await getCentroActualId())!

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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('stats.curso_activo')} value={cursoActivo?.nombre ?? t('stats.sin_curso')} />
        <Stat label={t('stats.aulas')} value={String(aulasCount)} />
        <Stat label={t('stats.ninos_activos')} value={String(ninosCount)} />
        <Stat label={t('stats.usuarios_activos')} value={String(usuariosCount)} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
