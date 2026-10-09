import { GraduationCapIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'
import {
  agruparRecorridoFamilia,
  etiquetaRecorrido,
  type RecorridoTramo,
} from '@/features/ninos/lib/recorrido-familia'

/**
 * F-8 (familia) — por dónde pasó el niño: una sección por curso (el más reciente primero),
 * con el aula, las fechas y «En curso» / «Terminado». Versión reducida de
 * `HistorialMatriculas` (Dirección): sin altas a medias, sin motivo de baja y sin
 * etiquetas internas. Solo la ve el tutor legal.
 */
export async function RecorridoFamilia({ tramos }: { tramos: RecorridoTramo[] }) {
  const t = await getTranslations('family.nino.recorrido')
  const cursos = agruparRecorridoFamilia(tramos)

  if (cursos.length === 0) {
    return (
      <Card>
        <EmptyState icon={<GraduationCapIcon strokeWidth={1.75} />} title={t('vacio')} />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {cursos.map((curso) => (
        <Card key={curso.curso_id} className="overflow-hidden">
          <CardContent className="space-y-3 pt-1">
            <h3 className="text-h3 text-foreground">{curso.curso_nombre}</h3>
            <ul className="space-y-2">
              {curso.tramos.map((tramo) => {
                const etiqueta = etiquetaRecorrido(tramo)
                return (
                  <li
                    key={tramo.id}
                    className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm"
                  >
                    <span className="text-foreground font-medium">{tramo.aula_nombre}</span>
                    <span className="text-muted-foreground text-xs">
                      {tramo.fecha_alta}
                      {' → '}
                      {tramo.fecha_baja ?? t('hoy')}
                    </span>
                    <Badge
                      variant={etiqueta === 'en_curso' ? 'success' : 'secondary'}
                      className="ml-auto"
                    >
                      {t(etiqueta)}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
