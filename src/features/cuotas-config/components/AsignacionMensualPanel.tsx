'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

import { setMetodoPago } from '../actions/set-metodo-pago'
import { ConfigurarModalidadDialog } from './ConfigurarModalidadDialog'
import { MesSelector } from './MesSelector'
import type { ConceptoAsignable } from '../queries/get-conceptos-asignables'
import type { ConfigNinoMes } from '../queries/get-config-mes'

type MetodoPago = Database['public']['Enums']['metodo_pago']
const METODOS: MetodoPago[] = ['sepa', 'efectivo', 'transferencia']

interface Props {
  centroId: string
  anio: number
  mes: number
  conceptos: ConceptoAsignable[]
  config: ConfigNinoMes[]
}

export function AsignacionMensualPanel({ centroId, anio, mes, conceptos, config }: Props) {
  const t = useTranslations('admin.cuotas')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MesSelector anio={anio} mes={mes} />
      </div>

      <Card className="border-amber-300/60 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
        {t('aviso_config')}
      </Card>

      {config.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">{t('sin_ninos')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fields.nino')}</TableHead>
                  <TableHead>{t('fields.metodo')}</TableHead>
                  <TableHead className="text-right">{t('fields.conceptos')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {config.map((c) => (
                  <NinoRow
                    key={c.nino_id}
                    centroId={centroId}
                    anio={anio}
                    mes={mes}
                    conceptos={conceptos}
                    config={c}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}

function NinoRow({
  centroId,
  anio,
  mes,
  conceptos,
  config,
}: {
  centroId: string
  anio: number
  mes: number
  conceptos: ConceptoAsignable[]
  config: ConfigNinoMes
}) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  const metodoItems = METODOS.map((m) => ({ value: m, label: t(`metodos.${m}`) }))

  function cambiarMetodo(metodo: MetodoPago) {
    startTransition(async () => {
      const r = await setMetodoPago(centroId, config.nino_id, anio, mes, metodo)
      if (r.success) toast.success(t('metodo_guardado'))
      else toast.error(tErrors(r.error))
    })
  }

  const nConfigurados = Object.keys(config.modalidades).length

  return (
    <TableRow>
      <TableCell className="font-medium">{config.nombre}</TableCell>
      <TableCell>
        <Select
          items={metodoItems}
          value={config.metodo ?? undefined}
          onValueChange={(v) => cambiarMetodo(v as MetodoPago)}
        >
          <SelectTrigger
            size="sm"
            className="w-48"
            disabled={pending}
            aria-label={t('fields.metodo')}
          >
            <SelectValue placeholder={t('sin_metodo')} />
          </SelectTrigger>
          <SelectContent>
            {metodoItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">
            {t('conceptos_configurados', { n: nConfigurados })}
          </span>
          <ConfigurarModalidadDialog
            centroId={centroId}
            ninoId={config.nino_id}
            ninoNombre={config.nombre}
            anio={anio}
            mes={mes}
            conceptos={conceptos}
            modalidades={config.modalidades}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}
