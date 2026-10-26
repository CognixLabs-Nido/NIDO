'use client'

import { useMemo, useState, useTransition } from 'react'
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
import { FiltroClaseYNombre } from '@/shared/components/FiltroClaseYNombre'
import { clasesDe, filtrarNinos } from '@/shared/lib/filtrar-ninos'

import { toggleElegibilidad } from '../actions/elegibilidad'
import type { AlumnoBeca } from '../lib/alumno-beca'

interface Props {
  alumnos: AlumnoBeca[]
}

/**
 * V2-2 — lista de alumnos activos del curso con un check "tiene beca comedor" por alumno, con
 * filtro por clase y búsqueda por nombre. Optimista: el check refleja el cambio al instante y
 * revierte si la action falla.
 */
export function ElegibilidadList({ alumnos }: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const tRoot = useTranslations()
  const [estado, setEstado] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(alumnos.map((a) => [a.id, a.elegible]))
  )
  const [pending, startTransition] = useTransition()
  const [aula, setAula] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const clases = useMemo(() => clasesDe(alumnos), [alumnos])
  const visibles = filtrarNinos(alumnos, aula, texto)

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
    <Card className="space-y-3 overflow-hidden p-4">
      <FiltroClaseYNombre
        clases={clases}
        aula={aula}
        onAula={setAula}
        texto={texto}
        onTexto={setTexto}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col_alumno')}</TableHead>
            <TableHead>{t('col_clase')}</TableHead>
            <TableHead className="w-32 text-center">{t('col_beca')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.nombre}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{a.aula ?? '—'}</TableCell>
              <TableCell className="text-center">
                <Checkbox
                  checked={estado[a.id] ?? false}
                  disabled={pending}
                  onCheckedChange={(v) => onToggle(a.id, v === true)}
                  aria-label={t('beca_de', { nombre: a.nombre })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {visibles.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {tRoot('common.filtro_ninos.sin_resultados')}
        </p>
      )}
    </Card>
  )
}
