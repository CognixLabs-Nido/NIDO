'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

import { eliminarBeca } from '../actions/beca'
import { BecaFormDialog, type OpcionMin } from './BecaFormDialog'
import { TiposBecaPanel } from './TiposBecaPanel'
import type { BecaListItem } from '../queries/get-becas'
import type { TipoBecaListItem } from '../queries/get-tipos-beca'

interface Props {
  centroId: string
  becas: BecaListItem[]
  tipos: TipoBecaListItem[]
  ninos: OpcionMin[]
}

export function BecasPanel({ centroId, becas, tipos, ninos }: Props) {
  const t = useTranslations('admin.cuotas')
  const tiposActivos: OpcionMin[] = tipos
    .filter((tp) => tp.activo)
    .map((tp) => ({ id: tp.id, nombre: tp.nombre }))

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-h2">{t('becas.becas_title')}</h2>
          <BecaFormDialog
            centroId={centroId}
            ninos={ninos}
            tipos={tiposActivos}
            trigger={<Button size="sm">{t('becas.nueva')}</Button>}
          />
        </div>
        {becas.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-center text-sm">
            {t('becas.becas_empty')}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('becas.fields.nino')}</TableHead>
                    <TableHead>{t('becas.fields.tipo')}</TableHead>
                    <TableHead>{t('becas.fields.importe')}</TableHead>
                    <TableHead>{t('becas.fields.periodo')}</TableHead>
                    <TableHead className="text-right">{t('fields.acciones')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {becas.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.nino_nombre}</TableCell>
                      <TableCell>{b.tipo_nombre}</TableCell>
                      <TableCell>{formatEuros(b.importe_centimos)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {b.fecha_desde}
                        {b.fecha_hasta ? ` → ${b.fecha_hasta}` : ' →'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <BecaFormDialog
                            centroId={centroId}
                            beca={b}
                            ninos={ninos}
                            tipos={tiposActivos}
                            trigger={
                              <Button size="sm" variant="outline">
                                {t('editar')}
                              </Button>
                            }
                          />
                          <EliminarBecaDialog id={b.id} nombre={b.nino_nombre} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      <TiposBecaPanel centroId={centroId} tipos={tipos} />
    </div>
  )
}

function EliminarBecaDialog({ id, nombre }: { id: string; nombre: string }) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await eliminarBeca(id)
      if (r.success) {
        toast.success(t('becas.deleted'))
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
          <DialogTitle>{t('becas.eliminar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('becas.eliminar_confirm', { nombre })}</p>
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
