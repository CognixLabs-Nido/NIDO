import { BookOpenIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { NuevaAulaDialog } from '@/features/aulas/components/NuevaAulaDialog'
import { TablaAulas } from '@/features/aulas/components/TablaAulas'
import { getAulasConPersonal } from '@/features/aulas/queries/get-aulas-con-personal'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminAulasPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.aulas')
  const centroId = (await getCentroActualId())!
  const cursoActivo = await getCursoActivo(centroId)

  if (!cursoActivo) {
    return (
      <div className="space-y-6">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Card>
          <EmptyState icon={<BookOpenIcon strokeWidth={1.75} />} title={t('sin_curso_activo')} />
        </Card>
      </div>
    )
  }

  // F5B-#36: query enriquecida con num_alumnos + profesoras + tecnicos.
  // El wizard de nuevo niño sigue usando getAulasPorCurso (D1) — esta
  // query enriquecida solo se necesita aquí.
  const aulas = await getAulasConPersonal(cursoActivo.id)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('curso_label')}:{' '}
            <span className="text-foreground font-medium">{cursoActivo.nombre}</span>
          </p>
        </div>
        <NuevaAulaDialog centroId={centroId} cursoAcademicoId={cursoActivo.id} />
      </header>
      {aulas.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpenIcon strokeWidth={1.75} />} title={t('empty')} />
        </Card>
      ) : (
        <TablaAulas
          aulas={aulas}
          locale={locale}
          labels={{
            fields: {
              nombre: t('fields.nombre'),
              anio_nacimiento: t('fields.anio_nacimiento'),
              capacidad: t('fields.capacidad'),
              num_alumnos: t('fields.num_alumnos'),
              // TODO(F5B#36): confirmar VA con usuario (`profesoras`).
              profesoras: t('fields.profesoras'),
              // TODO(F5B#36): confirmar VA con usuario (`tecnicos`).
              tecnicos: t('fields.tecnicos'),
              descripcion: t('fields.descripcion'),
            },
            // TODO(F5B#36): confirmar VA con usuario (`label_coordinadora`).
            label_coordinadora: t('personal.label_coordinadora'),
          }}
        />
      )}
    </div>
  )
}
