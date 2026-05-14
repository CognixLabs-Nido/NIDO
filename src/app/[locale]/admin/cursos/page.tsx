import { CalendarDaysIcon } from 'lucide-react'
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
import { ActivarCursoButton } from '@/features/cursos/components/ActivarCursoButton'
import { NuevoCursoDialog } from '@/features/cursos/components/NuevoCursoDialog'
import { getCursosPorCentro } from '@/features/cursos/queries/get-cursos'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { EmptyState } from '@/shared/components/EmptyState'

type CursoEstado = 'planificado' | 'activo' | 'cerrado'

const estadoVariant: Record<CursoEstado, 'success' | 'info' | 'secondary'> = {
  activo: 'success',
  planificado: 'info',
  cerrado: 'secondary',
}

export default async function AdminCursosPage() {
  const t = await getTranslations('admin.cursos')
  const centroId = (await getCentroActualId())!
  const cursos = await getCursosPorCentro(centroId)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <NuevoCursoDialog centroId={centroId} />
      </header>
      {cursos.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDaysIcon strokeWidth={1.75} />} title={t('empty')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
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
                  <TableCell className="text-muted-foreground text-sm">
                    {c.fecha_inicio} → {c.fecha_fin}
                  </TableCell>
                  <TableCell>
                    <Badge variant={estadoVariant[c.estado as CursoEstado] ?? 'outline'}>
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
        </Card>
      )}
    </div>
  )
}
