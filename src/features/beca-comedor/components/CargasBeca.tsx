'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
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

import { CargaFormDialog } from './CargaFormDialog'
import { borrarCarga } from '../actions/cargas-beca'
import { etiquetaMes } from '../lib/meses'
import type { CargaBecaItem } from '../queries/get-cargas-beca'
import type { MesCurso } from '../lib/cargas'

interface Props {
  cargas: CargaBecaItem[]
  meses: MesCurso[]
  mesesCerrados: MesCurso[]
  hayBecados: boolean
}

export function CargasBeca({ cargas, meses, mesesCerrados, hayBecados }: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const locale = useLocale()

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {hayBecados ? t('cargas_sub') : t('sin_becados_hint')}
        </p>
        <CargaFormDialog
          meses={meses}
          mesesCerrados={mesesCerrados}
          trigger={
            <Button size="sm" disabled={!hayBecados}>
              {t('nueva_carga')}
            </Button>
          }
        />
      </div>

      {cargas.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('sin_cargas')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_mes_corr')}</TableHead>
              <TableHead>{t('col_mes_aplic')}</TableHead>
              <TableHead className="text-right">{t('col_importe')}</TableHead>
              <TableHead className="text-center">{t('col_becados')}</TableHead>
              <TableHead className="w-40 text-right">{t('col_acciones')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargas.map((c) => {
              const key = `${c.anioCorrespondiente}-${c.mesCorrespondiente}`
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium">
                    {etiquetaMes(locale, c.anioCorrespondiente, c.mesCorrespondiente)}
                  </TableCell>
                  <TableCell>
                    {etiquetaMes(locale, c.anioAplicacion, c.mesAplicacion)}
                    {!c.editable && (
                      <Badge variant="secondary" className="ml-2">
                        {t('cerrado')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEuros(c.importeCentimos, locale)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{c.nBecados}</TableCell>
                  <TableCell className="text-right">
                    {c.editable ? (
                      <div className="flex justify-end gap-1">
                        <CargaFormDialog
                          meses={meses}
                          mesesCerrados={mesesCerrados}
                          carga={c}
                          trigger={
                            <Button size="sm" variant="secondary">
                              {t('editar')}
                            </Button>
                          }
                        />
                        <BorrarCargaDialog carga={c} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t('no_editable')}</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function BorrarCargaDialog({ carga }: { carga: CargaBecaItem }) {
  const t = useTranslations('admin.cuotas.beca_comedor')
  const tRoot = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onConfirm() {
    startTransition(async () => {
      const r = await borrarCarga({
        anio_correspondiente: carga.anioCorrespondiente,
        mes_correspondiente: carga.mesCorrespondiente,
      })
      if (r.success) {
        toast.success(t('carga_borrada'))
        setOpen(false)
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" className="text-destructive" />}>
        {t('borrar')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('borrar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t('borrar_confirm', { n: carga.nBecados })}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancelar')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {t('borrar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
