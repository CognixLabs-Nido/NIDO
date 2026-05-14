import { BabyIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { EmptyState } from '@/shared/components/EmptyState'

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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <Link
          href={`/${locale}/admin/ninos/nuevo`}
          className={buttonVariants({ className: 'gap-2' })}
        >
          <PlusIcon className="size-4" />
          {t('nuevo')}
        </Link>
      </header>
      {ninos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BabyIcon strokeWidth={1.75} />}
            title={t('empty')}
            cta={{ label: t('nuevo'), href: `/${locale}/admin/ninos/nuevo` }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
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
                  <TableCell className="text-muted-foreground text-sm">
                    {n.fecha_nacimiento}
                  </TableCell>
                  <TableCell>
                    {n.aula_actual ? (
                      <Badge variant="warm">{n.aula_actual}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">
                        {t('sin_matricula_activa')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/${locale}/admin/ninos/${n.id}`}
                      className="text-primary hover:text-primary-800 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      {t('ver')}
                      <ChevronRightIcon className="size-4" />
                    </Link>
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
