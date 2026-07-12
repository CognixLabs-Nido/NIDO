import { GraduationCapIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'
import {
  agruparHistoricoPorCurso,
  etiquetaEstadoTramo,
  type EtiquetaTramo,
  type HistoricoTramo,
} from '@/features/ninos/lib/historico-matriculas'

/** Variante de Badge por tipo de etiqueta (mapeo presentacional, sin lógica de negocio). */
const VARIANTE_BADGE: Record<
  EtiquetaTramo['tipo'],
  'success' | 'info' | 'secondary' | 'warm' | 'warning'
> = {
  en_curso: 'success',
  activa: 'success',
  paso_curso: 'info',
  finalizo_etapa: 'secondary',
  baja_motivo: 'warm',
  baja_sin_motivo: 'warm',
  pendiente: 'info',
  validar: 'warning',
}

/**
 * F-8 — Histórico del niño: recorrido por aulas/cursos, agrupado por curso académico (una
 * sección por año, más reciente primero). Cada tramo muestra aula, fecha_alta, fecha_baja
 * ("en curso" si sigue abierto) y un badge de estado legible. Solo lectura por naturaleza
 * (se usa igual en la ficha normal y en la archivada de F-3-E-1): no lleva ninguna acción.
 */
export async function HistorialMatriculas({ tramos }: { tramos: HistoricoTramo[] }) {
  const t = await getTranslations('admin.ninos')
  const tH = await getTranslations('admin.ninos.historico')

  if (tramos.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCapIcon strokeWidth={1.75} />}
          title={t('matriculas_vacias')}
        />
      </Card>
    )
  }

  const cursos = agruparHistoricoPorCurso(tramos)

  return (
    <div className="space-y-4">
      {cursos.map((curso) => (
        <Card key={curso.curso_id} className="overflow-hidden">
          <CardContent className="space-y-3 pt-1">
            <h3 className="text-h3 text-foreground flex items-center gap-2">
              <GraduationCapIcon
                className="text-muted-foreground size-4 shrink-0"
                strokeWidth={2}
              />
              {curso.curso_nombre}
            </h3>
            <ul className="space-y-2">
              {curso.tramos.map((tramo) => {
                const et = etiquetaEstadoTramo(tramo)
                const label =
                  et.tipo === 'baja_motivo'
                    ? tH('estado.baja_motivo', { motivo: et.motivo })
                    : tH(`estado.${et.tipo}`)
                return (
                  <li
                    key={tramo.id}
                    className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm"
                  >
                    <span className="text-foreground font-medium">{tramo.aula_nombre}</span>
                    <span className="text-muted-foreground text-xs">
                      {tramo.fecha_alta}
                      {' → '}
                      {tramo.fecha_baja ?? tH('en_curso_fecha')}
                    </span>
                    <Badge variant={VARIANTE_BADGE[et.tipo]} className="ml-auto">
                      {label}
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
