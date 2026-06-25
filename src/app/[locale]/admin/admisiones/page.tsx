import { ClipboardListIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursosPorCentro } from '@/features/cursos/queries/get-cursos'
import { ListaEsperaPanel } from '@/features/lista-espera/components/ListaEsperaPanel'
import { getListaEspera } from '@/features/lista-espera/queries/get-lista-espera'
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

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <ListaEsperaPanel
        cursos={cursos.map((c) => ({ id: c.id, nombre: c.nombre }))}
        cursoSeleccionadoId={seleccionado.id}
        prospectos={prospectos}
        locale={locale}
      />
    </div>
  )
}
