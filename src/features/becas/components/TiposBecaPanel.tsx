'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
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

import { eliminarTipoBeca } from '../actions/tipo-beca'
import { TipoBecaFormDialog } from './TipoBecaFormDialog'
import type { TipoBecaListItem } from '../queries/get-tipos-beca'

interface Props {
  centroId: string
  tipos: TipoBecaListItem[]
}

export function TiposBecaPanel({ centroId, tipos }: Props) {
  const t = useTranslations('admin.cuotas')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-h2">{t('becas.tipos_title')}</h2>
        <TipoBecaFormDialog
          centroId={centroId}
          trigger={
            <Button size="sm" variant="outline">
              {t('becas.tipo_nuevo')}
            </Button>
          }
        />
      </div>
      {tipos.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          {t('becas.tipos_empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('becas.fields.tipo_nombre')}</TableHead>
                <TableHead>{t('becas.fields.tipo_activo')}</TableHead>
                <TableHead className="text-right">{t('fields.acciones')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tipos.map((tipo) => (
                <TableRow key={tipo.id} className={tipo.activo ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{tipo.nombre}</TableCell>
                  <TableCell>
                    {tipo.activo ? (
                      <Badge variant="secondary">{t('becas.activo_si')}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <TipoBecaFormDialog
                        centroId={centroId}
                        tipo={tipo}
                        trigger={
                          <Button size="sm" variant="outline">
                            {t('editar')}
                          </Button>
                        }
                      />
                      <EliminarTipoBecaDialog id={tipo.id} nombre={tipo.nombre} />
                    </div>
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

function EliminarTipoBecaDialog({ id, nombre }: { id: string; nombre: string }) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await eliminarTipoBeca(id)
      if (r.success) {
        toast.success(t('becas.tipo_deleted'))
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
          <DialogTitle>{t('becas.tipo_eliminar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t('becas.tipo_eliminar_confirm', { nombre })}
        </p>
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
