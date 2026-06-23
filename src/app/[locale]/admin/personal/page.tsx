import { UsersIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { InvitacionesProfeList } from '@/features/auth/components/InvitacionesProfeList'
import { InvitarProfeDialog } from '@/features/auth/components/InvitarProfeDialog'
import { getInvitacionesProfePendientes } from '@/features/auth/queries/get-invitaciones-profe'
import { getAulasPorCurso } from '@/features/aulas/queries/get-aulas'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { PersonalActivoList } from '@/features/profes-aulas/components/PersonalActivoList'
import { getPersonalActivoCentro } from '@/features/profes-aulas/queries/get-personal-activo-centro'
import { createClient } from '@/lib/supabase/server'
import { BUCKET_USUARIOS_FOTOS, firmarRutasBucket } from '@/shared/lib/adjuntos/storage'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminPersonalPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.personal')
  const centroId = (await getCentroActualId())!
  const cursoActivo = await getCursoActivo(centroId)

  if (!cursoActivo) {
    return (
      <div className="space-y-6">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Card>
          <EmptyState icon={<UsersIcon strokeWidth={1.75} />} title={t('sin_curso_activo')} />
        </Card>
      </div>
    )
  }

  const aulas = await getAulasPorCurso(cursoActivo.id)
  const invitaciones = await getInvitacionesProfePendientes(centroId)

  // Personal activo del centro (una fila por persona). Las fotos van por URL
  // firmada del bucket privado `usuarios-fotos` (el admin las puede leer por RLS).
  const personal = await getPersonalActivoCentro(cursoActivo.id)
  const supabase = await createClient()
  const firmadas = await firmarRutasBucket(
    supabase,
    BUCKET_USUARIOS_FOTOS,
    personal.map((p) => p.foto_url).filter((x): x is string => !!x)
  )
  const personalVista = personal.map((p) => ({
    profe_id: p.profe_id,
    nombre_completo: p.nombre_completo,
    email: p.email,
    fotoUrl: p.foto_url ? (firmadas.get(p.foto_url) ?? null) : null,
    asignaciones: p.asignaciones,
  }))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <InvitarProfeDialog
          locale={locale}
          aulas={aulas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        />
      </header>

      <section className="space-y-3">
        <h2 className="text-foreground text-lg font-medium">{t('activos.title')}</h2>
        <PersonalActivoList items={personalVista} />
      </section>

      <section className="space-y-3">
        <h2 className="text-foreground text-lg font-medium">{t('pendientes.title')}</h2>
        <InvitacionesProfeList locale={locale} invitaciones={invitaciones} />
      </section>
    </div>
  )
}
