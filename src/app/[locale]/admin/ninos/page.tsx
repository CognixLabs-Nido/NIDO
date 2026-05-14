import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getNinosPorCentro } from '@/features/ninos/queries/get-ninos'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminNinosPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.ninos')
  const centroId = (await getCentroActualId())!
  const ninos = await getNinosPorCentro(centroId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <Link href={`/${locale}/admin/ninos/nuevo`} className={buttonVariants()}>
          {t('nuevo')}
        </Link>
      </div>
      {ninos.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fields.nombre')}</TableHead>
              <TableHead>{t('fields.apellidos')}</TableHead>
              <TableHead>{t('fields.fecha_nacimiento')}</TableHead>
              <TableHead>{t('fields.aula_actual')}</TableHead>
              <TableHead className="text-right">{t('fields.acciones')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ninos.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-medium">{n.nombre}</TableCell>
                <TableCell>{n.apellidos}</TableCell>
                <TableCell>{n.fecha_nacimiento}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {n.aula_actual ?? t('sin_matricula_activa')}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/${locale}/admin/ninos/${n.id}`} className="text-sm hover:underline">
                    {t('ver')}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
