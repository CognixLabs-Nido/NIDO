import { HistoryIcon } from 'lucide-react'
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
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { EmptyState } from '@/shared/components/EmptyState'

type Accion = 'INSERT' | 'UPDATE' | 'DELETE'

const accionVariant: Record<Accion, 'success' | 'info' | 'destructive'> = {
  INSERT: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
}

export default async function AdminAuditPage() {
  const t = await getTranslations('admin.audit')
  const centroId = (await getCentroActualId())!
  const supabase = await createClient()

  const { data: entries } = await supabase
    .from('audit_log')
    .select('id, tabla, accion, usuario_id, ts')
    .eq('centro_id', centroId)
    .order('ts', { ascending: false })
    .limit(100)

  // Lookup de nombres: una sola query para los usuarios distintos del lote.
  const usuarioIds = Array.from(
    new Set((entries ?? []).map((e) => e.usuario_id).filter((id): id is string => id !== null))
  )

  let nombrePorUsuario = new Map<string, string>()
  if (usuarioIds.length > 0) {
    const { data: usuarios } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .in('id', usuarioIds)
    nombrePorUsuario = new Map(
      (usuarios ?? []).map((u) => [u.id, u.nombre_completo?.trim() || u.id.slice(0, 8)])
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </header>
      {!entries || entries.length === 0 ? (
        <Card>
          <EmptyState icon={<HistoryIcon strokeWidth={1.75} />} title={t('empty')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.ts')}</TableHead>
                <TableHead>{t('fields.tabla')}</TableHead>
                <TableHead>{t('fields.accion')}</TableHead>
                <TableHead>{t('fields.usuario')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const usuarioLabel = !e.usuario_id
                  ? t('sistema')
                  : (nombrePorUsuario.get(e.usuario_id) ?? e.usuario_id.slice(0, 8))
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {new Date(e.ts).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{e.tabla}</TableCell>
                    <TableCell>
                      <Badge variant={accionVariant[e.accion as Accion] ?? 'outline'}>
                        {e.accion}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{usuarioLabel}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
