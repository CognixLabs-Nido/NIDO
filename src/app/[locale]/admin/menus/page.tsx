import { UtensilsCrossedIcon } from 'lucide-react'
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
import { EmptyState } from '@/shared/components/EmptyState'

import { NuevaPlantillaDialog } from '@/features/menus/components/NuevaPlantillaDialog'
import { AccionesPlantilla } from '@/features/menus/components/AccionesPlantilla'
import { getPlantillasCentro } from '@/features/menus/queries/get-plantillas-centro'
import type { EstadoPlantillaMenu } from '@/features/menus/schemas/menu'

const estadoVariant: Record<EstadoPlantillaMenu, 'success' | 'info' | 'secondary'> = {
  publicada: 'success',
  borrador: 'info',
  archivada: 'secondary',
}

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminMenusPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('menus')
  const plantillas = await getPlantillasCentro()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <NuevaPlantillaDialog />
      </header>

      {plantillas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UtensilsCrossedIcon strokeWidth={1.75} />}
            title={t('ningun_plantilla')}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('campos.nombre')}</TableHead>
                <TableHead>{t('campos.vigente_desde')}</TableHead>
                <TableHead>{t('campos.vigente_hasta')}</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plantillas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/${locale}/admin/menus/${p.id}`}
                      className="hover:underline"
                      data-testid={`plantilla-link-${p.id}`}
                    >
                      {p.nombre}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.vigente_desde ?? t('campos.vigencia_sin')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.vigente_hasta ?? t('campos.vigencia_sin')}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={estadoVariant[p.estado] ?? 'outline'}
                      data-testid={`plantilla-estado-${p.id}`}
                    >
                      {t(`estado.${p.estado}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <AccionesPlantilla
                      plantillaId={p.id}
                      estado={p.estado}
                      labels={{
                        publicar: t('publicar'),
                        publicarConfirmTitle: t('publicar_confirm_title'),
                        publicarConfirmDesc: t('publicar_confirm_desc'),
                        publicarConfirmSi: t('publicar_confirm_si'),
                        archivar: t('archivar'),
                        archivarConfirmTitle: t('archivar_confirm_title'),
                        archivarConfirmDesc: t('archivar_confirm_desc'),
                        archivarConfirmSi: t('archivar_confirm_si'),
                        cancelar: 'Cancelar',
                      }}
                    />
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
