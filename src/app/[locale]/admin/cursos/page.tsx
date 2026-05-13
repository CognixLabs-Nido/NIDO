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
import { ActivarCursoButton } from '@/features/cursos/components/ActivarCursoButton'
import { NuevoCursoDialog } from '@/features/cursos/components/NuevoCursoDialog'
import { getCursosPorCentro } from '@/features/cursos/queries/get-cursos'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'

export default async function AdminCursosPage() {
  const t = await getTranslations('admin.cursos')
  const centroId = (await getCentroActualId())!
  const cursos = await getCursosPorCentro(centroId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <NuevoCursoDialog centroId={centroId} />
      </div>
      {cursos.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fields.nombre')}</TableHead>
              <TableHead>{t('fields.fechas')}</TableHead>
              <TableHead>{t('fields.estado')}</TableHead>
              <TableHead className="text-right">{t('fields.acciones')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cursos.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nombre}</TableCell>
                <TableCell className="text-sm">
                  {c.fecha_inicio} → {c.fecha_fin}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      c.estado === 'activo'
                        ? 'default'
                        : c.estado === 'cerrado'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {t(`estados.${c.estado}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {c.estado !== 'activo' && c.estado !== 'cerrado' ? (
                    <ActivarCursoButton cursoId={c.id} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
