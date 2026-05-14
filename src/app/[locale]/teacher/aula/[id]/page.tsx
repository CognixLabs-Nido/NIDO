import { BabyIcon, ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
import { createClient } from '@/lib/supabase/server'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function TeacherAulaPage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('teacher.aula')
  const tNav = await getTranslations('teacher.nav')
  const aula = await getAulaById(id)
  if (!aula) notFound()

  const supabase = await createClient()
  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('id, ninos(id, nombre, apellidos, fecha_nacimiento)')
    .eq('aula_id', id)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  type NinoRow = { id: string; nombre: string; apellidos: string; fecha_nacimiento: string }
  const ninos = (matriculas ?? [])
    .map((m): NinoRow | null => {
      const raw = m.ninos as NinoRow | NinoRow[] | null
      if (!raw) return null
      if (Array.isArray(raw)) return raw[0] ?? null
      return raw
    })
    .filter((n): n is NinoRow => n !== null)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground">{aula.nombre}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('cohorte_label')}:</span>
          {aula.cohorte_anos_nacimiento.map((y) => (
            <Badge key={y} variant="warm">
              {y}
            </Badge>
          ))}
        </div>
      </header>
      {ninos.length === 0 ? (
        <Card>
          <EmptyState icon={<BabyIcon strokeWidth={1.75} />} title={t('ningun_nino')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.nombre')}</TableHead>
                <TableHead>{t('fields.apellidos')}</TableHead>
                <TableHead>{t('fields.fecha_nacimiento')}</TableHead>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
