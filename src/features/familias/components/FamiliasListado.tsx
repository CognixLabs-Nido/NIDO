'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/shared/components/EmptyState'
import { UsersIcon } from 'lucide-react'

import type { FamiliaGestionItem } from '../queries/get-familias-gestion'

type Filtro = 'todas' | 'activas' | 'inactivas'

/**
 * F-6a — listado navegable de familias de Dirección: filtro Todas/Activas/Inactivas
 * (default Activas) + búsqueda por etiqueta o titular. Cada fila enlaza a la ficha.
 */
export function FamiliasListado({
  familias,
  locale,
}: {
  familias: FamiliaGestionItem[]
  locale: string
}) {
  const t = useTranslations('admin.familias')
  const [filtro, setFiltro] = useState<Filtro>('activas')
  const [query, setQuery] = useState('')

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return familias.filter((f) => {
      if (filtro === 'activas' && f.estado !== 'activa') return false
      if (filtro === 'inactivas' && f.estado !== 'inactiva') return false
      if (!q) return true
      return (
        (f.etiqueta ?? '').toLowerCase().includes(q) ||
        (f.titularNombre ?? '').toLowerCase().includes(q)
      )
    })
  }, [familias, filtro, query])

  const filtros: Filtro[] = ['todas', 'activas', 'inactivas']

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {filtros.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={filtro === f ? 'default' : 'outline'}
              onClick={() => setFiltro(f)}
            >
              {t(`filtro.${f}`)}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('buscar_placeholder')}
          className="max-w-xs"
        />
      </div>

      {visibles.length === 0 ? (
        <Card>
          <EmptyState icon={<UsersIcon strokeWidth={1.75} />} title={t('empty')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.etiqueta')}</TableHead>
                <TableHead>{t('fields.titular')}</TableHead>
                <TableHead>{t('fields.hijos')}</TableHead>
                <TableHead>{t('fields.estado')}</TableHead>
                <TableHead className="text-right">{t('fields.acciones')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((f) => (
                <TableRow key={f.id} className={f.estado === 'inactiva' ? 'opacity-70' : undefined}>
                  <TableCell className="font-medium">{f.etiqueta ?? '—'}</TableCell>
                  <TableCell>{f.titularNombre ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{f.hijosActivos}</TableCell>
                  <TableCell>
                    {f.estado === 'inactiva' ? (
                      <Badge variant="warm">{t('estado.archivada')}</Badge>
                    ) : (
                      <Badge variant="success">{t('estado.activa')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/${locale}/admin/familias/${f.id}`}
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
