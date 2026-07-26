'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { toggleElegibilidad } from '../actions/elegibilidad'
import type { AlumnoElegibilidad } from '../queries/get-elegibilidad-becados'

interface Props {
  alumnos: AlumnoElegibilidad[]
}

/**
 * V2-2 — lista de alumnos activos del curso con un check "tiene beca comedor" por alumno.
 * Optimista: el check refleja el cambio al instante y revierte si la action falla.
 */
export function ElegibilidadList({ alumnos }: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const tRoot = useTranslations()
  const [estado, setEstado] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(alumnos.map((a) => [a.id, a.elegible]))
  )
  const [pending, startTransition] = useTransition()

  function onToggle(ninoId: string, next: boolean) {
    setEstado((prev) => ({ ...prev, [ninoId]: next }))
    startTransition(async () => {
      const r = await toggleElegibilidad({ nino_id: ninoId, activa: next })
      if (!r.success) {
        setEstado((prev) => ({ ...prev, [ninoId]: !next })) // revertir
        toast.error(tRoot(r.error))
      }
    })
  }

  if (alumnos.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-xs">{t('sin_alumnos')}</p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col_alumno')}</TableHead>
            <TableHead className="w-32 text-center">{t('col_beca')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alumnos.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.nombre}</TableCell>
              <TableCell className="text-center">
                <Checkbox
                  checked={estado[a.id] ?? false}
                  disabled={pending}
                  onCheckedChange={(v) => onToggle(a.id, v === true)}
                  aria-label={t('col_beca')}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
