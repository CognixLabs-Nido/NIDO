import { ChevronRightIcon, ImageOffIcon } from 'lucide-react'
import Link from 'next/link'
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
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getRevocacionesPendientes } from '@/features/fotos/queries/get-revocaciones-pendientes'
import { EmptyState } from '@/shared/components/EmptyState'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * IU-5 — listado general de revocaciones con fotos pendientes de resolver (Dirección).
 * Niños con imagen revocada que aún aparecen etiquetados en publicaciones ocultas. Al
 * resolver todas sus fotos, el niño desaparece de esta lista. Solo admin (RLS + layout).
 */
export default async function FotosRevocadasPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.fotosRevocadas')
  const centroId = (await getCentroActualId())!
  const revocaciones = await getRevocacionesPendientes(centroId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('descripcion')}</p>
      </header>

      {revocaciones.length === 0 ? (
        <Card>
          <EmptyState icon={<ImageOffIcon />} title={t('vacio')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_nino')}</TableHead>
                <TableHead className="text-right">{t('col_pendientes')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {revocaciones.map((r) => (
                <TableRow key={r.ninoId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/${locale}/admin/fotos-revocadas/${r.ninoId}`}
                      className="hover:underline"
                    >
                      {`${r.nombre} ${r.apellidos ?? ''}`.trim()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{t('pendientes', { count: r.pendientes })}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${locale}/admin/fotos-revocadas/${r.ninoId}`}
                      aria-label={t('gestionar')}
                    >
                      <ChevronRightIcon className="text-muted-foreground size-4" />
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
