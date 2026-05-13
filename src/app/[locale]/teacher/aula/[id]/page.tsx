import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

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

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function TeacherAulaPage({ params }: PageProps) {
  const { id } = await params
  const t = await getTranslations('teacher.aula')
  const aula = await getAulaById(id)
  if (!aula) notFound()

  // RLS hace todo el filtrado: ver solo niños matriculados en esta aula.
  const supabase = await createClient()
  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('id, ninos(id, nombre, apellidos, fecha_nacimiento)')
    .eq('aula_id', id)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const ninos = (matriculas ?? []).map((m) => m.ninos).filter(Boolean) as Array<{
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
  }>

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-semibold">{aula.nombre}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('cohorte_label')}: {aula.cohorte_anos_nacimiento.join(', ')}
      </p>
      {ninos.length === 0 ? (
        <p className="text-muted-foreground mt-6">{t('ningun_nino')}</p>
      ) : (
        <Table className="mt-6">
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
                <TableCell>{n.fecha_nacimiento}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
