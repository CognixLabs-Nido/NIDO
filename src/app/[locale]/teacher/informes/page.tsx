import { ClipboardListIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CrearInformeDialog } from '@/features/informes/components/CrearInformeDialog'
import { getInformesDeMisAulas } from '@/features/informes/queries/get-informes-profe'
import { getPlantillasInforme } from '@/features/informes/queries/get-plantillas-informe'
import { PERIODOS_INFORME } from '@/features/informes/types'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Informes de evolución — vista del profe. Lista sus aulas y, por niño, el estado
 * del informe de cada período (curso activo). Coordinadora/profesora pueden crear
 * y rellenar; tecnico/apoyo solo leen (sin botón crear, celdas de solo lectura).
 */
export default async function TeacherInformesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('informes')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const [aulas, plantillas] = await Promise.all([
    getInformesDeMisAulas(),
    getPlantillasInforme(false),
  ])

  const puedeCrear = aulas.some((a) => a.puedeRedactar)
  // Niños de las aulas donde el profe redacta (para el diálogo de creación).
  const ninosRedactables = Array.from(
    new Map(
      aulas
        .filter((a) => a.puedeRedactar)
        .flatMap((a) => a.ninos)
        .map((n) => [n.id, { id: n.id, label: `${n.nombre} ${n.apellidos}` }])
    ).values()
  )
  const plantillaOpts = plantillas.map((p) => ({ id: p.id, label: p.titulo }))

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <ClipboardListIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('teacher_intro')}</p>
        </div>
        {puedeCrear && (
          <CrearInformeDialog locale={locale} ninos={ninosRedactables} plantillas={plantillaOpts} />
        )}
      </header>

      {aulas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('teacher_sin_aulas')}</p>
      ) : (
        aulas.map((aula) => (
          <section key={aula.id} className="space-y-3">
            <h2 className="text-h2 text-foreground">{aula.nombre}</h2>
            {aula.ninos.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('teacher_aula_vacia')}</p>
            ) : (
              <ul className="divide-border divide-y rounded-lg border">
                {aula.ninos.map((nino) => (
                  <li key={nino.id} className="px-4 py-3">
                    <p className="mb-2 font-medium">
                      {nino.nombre} {nino.apellidos}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {PERIODOS_INFORME.map((periodo) => {
                        const est = nino.porPeriodo[periodo]
                        const label = t(`periodos.${periodo}`)
                        if (est.id) {
                          return (
                            <Link
                              key={periodo}
                              href={`/${locale}/teacher/informes/${est.id}`}
                              className="bg-muted/40 hover:bg-muted flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                            >
                              <span>{label}</span>
                              <span className="text-muted-foreground">
                                · {t(`estado.${est.estado}`)}
                              </span>
                            </Link>
                          )
                        }
                        return (
                          <span
                            key={periodo}
                            className="text-muted-foreground flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs"
                          >
                            <span>{label}</span>
                            <span>· {t('teacher_sin_iniciar')}</span>
                          </span>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  )
}
