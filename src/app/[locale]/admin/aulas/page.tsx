import { BookOpenIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { NuevaAulaDialog } from '@/features/aulas/components/NuevaAulaDialog'
import { getAulasPorCurso } from '@/features/aulas/queries/get-aulas'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { EmptyState } from '@/shared/components/EmptyState'

export default async function AdminAulasPage() {
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

  const aulas = await getAulasPorCurso(cursoActivo.id)

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
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.nombre')}</TableHead>
                <TableHead>{t('fields.cohorte')}</TableHead>
                <TableHead>{t('fields.capacidad')}</TableHead>
                <TableHead>{t('fields.descripcion')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aulas.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.nombre}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {a.cohorte_anos_nacimiento.map((anio) => (
                        <Badge key={anio} variant="warm">
                          {anio}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{a.capacidad_maxima}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {a.descripcion ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
