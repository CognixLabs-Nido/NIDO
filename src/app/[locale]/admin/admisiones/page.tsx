import { ClipboardListIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursosPorCentro } from '@/features/cursos/queries/get-cursos'
import { ListaEsperaPanel } from '@/features/lista-espera/components/ListaEsperaPanel'
import { getAulasConOcupacion } from '@/features/lista-espera/queries/get-aulas-con-ocupacion'
import { getListaEspera } from '@/features/lista-espera/queries/get-lista-espera'
import { AnadirHijoAFamiliaDialog } from '@/features/familias/components/AnadirHijoAFamiliaDialog'
import { getFamiliasPorCentro } from '@/features/familias/queries/get-familias'
import { getAulasCursoActivo } from '@/features/aulas/queries/get-aulas-curso-activo'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ curso?: string }>
}

export default async function AdmisionesPage({ params, searchParams }: PageProps) {
  const t = await getTranslations('admin.admisiones')
  const { locale } = await params
  const centroId = (await getCentroActualId())!
  const cursos = await getCursosPorCentro(centroId)

  if (cursos.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Card>
          <EmptyState
            icon={<ClipboardListIcon strokeWidth={1.75} />}
            title={t('sin_cursos')}
            description={t('sin_cursos_desc')}
          />
        </Card>
      </div>
    )
  }

  const { curso } = await searchParams
  const seleccionado =
    cursos.find((c) => c.id === curso) ?? cursos.find((c) => c.estado === 'activo') ?? cursos[0]!
  const prospectos = await getListaEspera(seleccionado.id)

  // Aulas del CURSO ACTIVO con su ocupación: al invitar se fija el aula y se crea la
  // matrícula pendiente contra el curso activo (el alta opera siempre sobre él).
  const cursoActivo = cursos.find((c) => c.estado === 'activo')
  const aulas = cursoActivo ? await getAulasConOcupacion(cursoActivo.id) : []

  // F-2b-4-2: acción hermana "añadir hijo a familia existente" (fuera de la lista de espera).
  const [familias, aulasCursoActivo] = await Promise.all([
    getFamiliasPorCentro(centroId),
    getAulasCursoActivo(centroId),
  ])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <AnadirHijoAFamiliaDialog
          familias={familias}
          aulas={aulasCursoActivo.map((a) => ({ id: a.id, nombre: a.nombre }))}
          locale={locale}
        />
      </header>
      <ListaEsperaPanel
        cursos={cursos.map((c) => ({ id: c.id, nombre: c.nombre }))}
        cursoSeleccionadoId={seleccionado.id}
        prospectos={prospectos}
        aulas={aulas}
        locale={locale}
      />
    </div>
  )
}
