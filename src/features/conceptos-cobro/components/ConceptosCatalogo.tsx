'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatEuros } from '@/shared/lib/format-money'

import { eliminarConcepto, setActivoConcepto } from '../actions/estado-concepto'
import { ConceptoFormDialog } from './ConceptoFormDialog'
import type { ConceptoCobroListItem } from '../queries/get-conceptos-cobro'

interface Props {
  centroId: string
  conceptos: ConceptoCobroListItem[]
}

/** Valor legible del concepto: signo (− si descuento) + importe fijo (€/día si diario) o %. */
function formatValor(c: ConceptoCobroListItem, t: ReturnType<typeof useTranslations>): string {
  const prefijo = c.signo < 0 ? '−' : ''
  if (c.tipo_valor === 'porcentaje') {
    return `${prefijo}${(c.porcentaje_bp ?? 0) / 100}%`
  }
  const euros = formatEuros(c.importe_centimos ?? 0)
  return c.tipo_concepto === 'diario'
    ? `${prefijo}${t('precio_por_dia', { precio: euros })}`
    : `${prefijo}${euros}`
}

export function ConceptosCatalogo({ centroId, conceptos }: Props) {
  const t = useTranslations('admin.cuotas')

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ConceptoFormDialog
          centroId={centroId}
          conceptos={conceptos}
          trigger={<Button>{t('nuevo')}</Button>}
        />
      </div>

      {conceptos.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">{t('empty')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fields.nombre')}</TableHead>
                  <TableHead>{t('fields.tipo')}</TableHead>
                  <TableHead>{t('fields.precio')}</TableHead>
                  <TableHead>{t('fields.aplicacion')}</TableHead>
                  <TableHead>{t('fields.activo')}</TableHead>
                  <TableHead className="text-right">{t('fields.acciones')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conceptos.map((c) => (
                  <ConceptoRow key={c.id} centroId={centroId} concepto={c} conceptos={conceptos} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}

function ConceptoRow({
  centroId,
  concepto,
  conceptos,
}: {
  centroId: string
  concepto: ConceptoCobroListItem
  conceptos: ConceptoCobroListItem[]
}) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  function toggleActivo(activo: boolean) {
    startTransition(async () => {
      const r = await setActivoConcepto(concepto.id, activo)
      if (!r.success) toast.error(tErrors(r.error))
    })
  }

  return (
    <TableRow className={concepto.activo ? undefined : 'opacity-60'}>
      <TableCell className="font-medium">{concepto.nombre}</TableCell>
      <TableCell>
        <Badge variant="secondary">{t(`tipos.${concepto.tipo_concepto}`)}</Badge>
      </TableCell>
      <TableCell>{formatValor(concepto, t)}</TableCell>
      <TableCell>
        <Badge variant={concepto.aplicacion === 'automatico' ? 'default' : 'outline'}>
          {t(`aplicaciones_badge.${concepto.aplicacion === 'automatico' ? 'automatico' : 'manual'}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <Checkbox
          checked={concepto.activo}
          disabled={pending}
          onCheckedChange={(c) => toggleActivo(c === true)}
          aria-label={t('fields.activo')}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <ConceptoFormDialog
            centroId={centroId}
            concepto={concepto}
            conceptos={conceptos}
            trigger={
              <Button variant="outline" size="sm">
                {t('editar')}
              </Button>
            }
          />
          <EliminarConceptoDialog id={concepto.id} nombre={concepto.nombre} />
        </div>
      </TableCell>
    </TableRow>
  )
}

function EliminarConceptoDialog({ id, nombre }: { id: string; nombre: string }) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await eliminarConcepto(id)
      if (r.success) {
        toast.success(t('deleted'))
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-destructive">
            {t('eliminar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('eliminar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('eliminar_confirm', { nombre })}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirmar}>
            {pending ? t('deleting') : t('eliminar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
