import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
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

export default async function AdminAulasPage() {
  const t = await getTranslations('admin.aulas')
  const centroId = (await getCentroActualId())!
  const cursoActivo = await getCursoActivo(centroId)

  if (!cursoActivo) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('sin_curso_activo')}</p>
      </div>
    )
  }

  const aulas = await getAulasPorCurso(cursoActivo.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <NuevaAulaDialog centroId={centroId} cursoAcademicoId={cursoActivo.id} />
      </div>
      <p className="text-muted-foreground text-sm">
        {t('curso_label')}: <span className="font-medium">{cursoActivo.nombre}</span>
      </p>
      {aulas.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
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
                      <Badge key={anio} variant="outline">
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
      )}
    </div>
  )
}
