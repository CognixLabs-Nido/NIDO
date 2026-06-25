import { ArrowRightIcon, CalendarDaysIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursosPlanificados } from '@/features/cursos/queries/get-cursos'
import { computarPropuesta, construirFilasRollover } from '@/features/pasar-de-curso/lib/proponer'
import { getEstadoRollover } from '@/features/pasar-de-curso/queries/get-estado-rollover'
import { PasarDeCursoWizard } from '@/features/pasar-de-curso/components/PasarDeCursoWizard'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ curso?: string }>
}

export default async function PasarDeCursoPage({ searchParams }: PageProps) {
  const t = await getTranslations('admin.pasarDeCurso')
  const centroId = (await getCentroActualId())!
  const planificados = await getCursosPlanificados(centroId)

  if (planificados.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Card>
          <EmptyState
            icon={<CalendarDaysIcon strokeWidth={1.75} />}
            title={t('sin_planificado')}
            description={t('sin_planificado_desc')}
          />
        </Card>
      </div>
    )
  }

  const { curso } = await searchParams
  const target = planificados.find((c) => c.id === curso) ?? planificados[0]!
  const estado = await getEstadoRollover(target.id)
  if (!estado) {
    return (
      <div className="space-y-6">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Card>
          <EmptyState icon={<CalendarDaysIcon strokeWidth={1.75} />} title={t('error_estado')} />
        </Card>
      </div>
    )
  }

  // Propuesta "pendiente de generar" (niños aún sin matrícula en el destino).
  const pendientesMap = new Map(estado.pendientes.map((p) => [p.nino_id, p.aula_id]))
  const preview = computarPropuesta(
    estado.ninosActivos,
    estado.aulasDestino,
    new Set(pendientesMap.keys())
  )
  // Tabla de revisión (decisión H-2-1): 1 fila por niño activo, propuesta pre-rellena.
  const filas = construirFilasRollover(estado.ninosActivos, preview, pendientesMap)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-foreground font-medium">
            {estado.cursoOrigen?.nombre ?? t('sin_origen')}
          </span>
          <ArrowRightIcon className="size-4" />
          <span className="text-foreground font-medium">{estado.cursoDestino.nombre}</span>
        </p>
      </header>
      <PasarDeCursoWizard
        estado={estado}
        preview={preview}
        filas={filas}
        planificados={planificados.map((c) => ({ id: c.id, nombre: c.nombre }))}
      />
    </div>
  )
}
