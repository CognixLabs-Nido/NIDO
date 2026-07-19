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

import { eliminarBecaComedorMes } from '../actions/beca-comedor-mes'
import { BecaComedorFormDialog } from './BecaComedorFormDialog'
import type { BecaComedorMesItem } from '../queries/get-becas-comedor-mes'

interface Props {
  anio: number
  mes: number
  ninos: Array<{ id: string; nombre: string }>
  /** Beca comedor del mes por nino_id (undefined = ese niño no tiene beca este mes). */
  becas: Record<string, BecaComedorMesItem>
  /** Mes cerrado: los recibos están congelados → edición deshabilitada. */
  cerrado: boolean
}

/** Formatea euros (numeric, NO céntimos) como importe localizado. */
function formatEurosDirecto(euros: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros)
}

/**
 * D-6-3: bloque de edición de la beca comedor variable por niño y mes, dentro del tab
 * "Panel del mes". Hereda `anio/mes` de la page (mismo MesSelector del panel de recibos).
 * La beca se refleja en el recibo al (RE)GENERAR los recibos del mes, no sobre recibos ya
 * generados. Deshabilitado si el mes está cerrado. Solo admin (RLS D-6-1).
 */
export function BecaComedorMesPanel({ anio, mes, ninos, becas, cerrado }: Props) {
  const t = useTranslations('admin.cuotas')

  return (
    <Card className="mt-6 space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="text-h2">{t('beca_comedor.title')}</h2>
        <p className="text-muted-foreground text-sm">{t('beca_comedor.subtitle')}</p>
        <p className="text-muted-foreground text-xs">{t('beca_comedor.note_regenerar')}</p>
        {cerrado && (
          <Badge variant="secondary" className="mt-1">
            {t('beca_comedor.mes_cerrado')}
          </Badge>
        )}
      </div>

      {ninos.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          {t('beca_comedor.sin_ninos')}
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('beca_comedor.col_nino')}</TableHead>
                <TableHead className="text-right">{t('beca_comedor.col_importe')}</TableHead>
                <TableHead className="text-right">{t('fields.acciones')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ninos.map((nino) => {
                const beca = becas[nino.id]
                return (
                  <TableRow key={nino.id}>
                    <TableCell className="font-medium">{nino.nombre}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {beca ? formatEurosDirecto(beca.importeEuros) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <BecaComedorFormDialog
                          nino={nino}
                          anio={anio}
                          mes={mes}
                          importeEuros={beca?.importeEuros}
                          trigger={
                            <Button size="sm" variant="outline" disabled={cerrado}>
                              {beca ? t('editar') : t('beca_comedor.poner')}
                            </Button>
                          }
                        />
                        {beca && (
                          <EliminarBecaComedorDialog
                            nino={nino}
                            anio={anio}
                            mes={mes}
                            disabled={cerrado}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}

function EliminarBecaComedorDialog({
  nino,
  anio,
  mes,
  disabled,
}: {
  nino: { id: string; nombre: string }
  anio: number
  mes: number
  disabled: boolean
}) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const r = await eliminarBecaComedorMes({ nino_id: nino.id, anio, mes })
      if (r.success) {
        toast.success(t('beca_comedor.deleted'))
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
          <Button variant="ghost" size="sm" className="text-destructive" disabled={disabled}>
            {t('beca_comedor.quitar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('beca_comedor.eliminar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t('beca_comedor.eliminar_confirm', { nombre: nino.nombre })}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirmar}>
            {pending ? t('deleting') : t('beca_comedor.quitar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
