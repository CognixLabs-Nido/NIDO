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
import { createClient } from '@/lib/supabase/server'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'

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
  // RLS permite al admin del centro leer la tabla usuarios para miembros del
  // mismo centro vía policy `usuarios_admin_select`.
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
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      {!entries || entries.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
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
              let usuarioLabel: string
              if (!e.usuario_id) {
                usuarioLabel = t('sistema')
              } else {
                usuarioLabel = nombrePorUsuario.get(e.usuario_id) ?? e.usuario_id.slice(0, 8)
              }
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(e.ts).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">{e.tabla}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.accion === 'INSERT'
                          ? 'default'
                          : e.accion === 'UPDATE'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {e.accion}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{usuarioLabel}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
