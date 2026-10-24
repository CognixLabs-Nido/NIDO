'use client'

import { Fragment, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/shared/lib/format-money'

import { etiquetaMes, etiquetaMesCorta, mesKey } from '../lib/meses'
import {
  aplicado,
  queda,
  type BecaMes,
  type EstadoBeca,
  type FilaPanel,
  type PanelBecas as Panel,
} from '../lib/panel-becas'

interface Props {
  panel: Panel | null
  error: boolean
}

/** Borde de la celda cuya beca no cupo entera en el recibo (desborde). */
const MARCA_EXCESO = 'ring-2 ring-accent-yellow-300'

const VARIANTE: Record<EstadoBeca, 'success' | 'info' | 'outline' | 'secondary'> = {
  descontada: 'success',
  en_recibo: 'info',
  por_aplicar: 'outline',
  anulada: 'secondary',
}

/**
 * PR-11 — panel de becas: todos los alumnos con beca comedor del curso, con su beca de cada mes
 * (el color dice si ya se descontó, si está en un recibo sin validar o si falta por aplicar),
 * lo aplicado y lo que queda. «Detalle» explica cada beca: en qué recibo y lo que no cupo.
 */
export function PanelBecas({ panel, error }: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor.panel')
  const locale = useLocale()
  const [abierto, setAbierto] = useState<string | null>(null)
  const eur = (c: number) => formatEuros(c, locale)

  if (error) {
    return (
      <Card className="p-4">
        <p className="text-destructive text-sm">{t('error')}</p>
      </Card>
    )
  }
  if (!panel) return null
  if (panel.filas.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-xs">{t('sin_alumnos')}</p>
      </Card>
    )
  }

  const { totales } = panel
  const nCols = panel.meses.length + 4

  return (
    <Card className="space-y-3 p-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra etiqueta={t('stat_alumnos')} valor={String(panel.filas.length)} />
        <Cifra etiqueta={t('stat_asignado')} valor={eur(totales.asignado)} />
        <Cifra etiqueta={t('stat_aplicado')} valor={eur(aplicado(totales))} />
        <Cifra etiqueta={t('stat_queda')} valor={eur(queda(totales))} />
      </dl>

      {totales.porResolver > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('por_resolver_aviso', { importe: eur(totales.porResolver) })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t('leyenda')}</span>
        {(['descontada', 'en_recibo', 'por_aplicar'] as const).map((e) => (
          <Badge key={e} variant={VARIANTE[e]}>
            {t(`estado_${e}`)}
          </Badge>
        ))}
        <Badge variant="outline" className={MARCA_EXCESO}>
          {t('leyenda_exceso')}
        </Badge>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="bg-card sticky left-0 z-10 min-w-40">{t('col_alumno')}</TableHead>
            {panel.meses.map((m) => (
              <TableHead key={mesKey(m.anio, m.mes)} className="text-center whitespace-nowrap">
                {etiquetaMesCorta(locale, m.anio, m.mes)}
              </TableHead>
            ))}
            <TableHead className="text-right whitespace-nowrap">{t('col_asignado')}</TableHead>
            <TableHead className="text-right whitespace-nowrap">{t('col_aplicado')}</TableHead>
            <TableHead className="text-right whitespace-nowrap">{t('col_queda')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {panel.filas.map((f) => (
            <Fragment key={f.id}>
              <TableRow>
                <TableCell className="bg-card sticky left-0 z-10 align-top">
                  <div className="font-medium">{f.nombre}</div>
                  <div className="flex flex-wrap gap-1">
                    {!f.becado && <Badge variant="secondary">{t('sin_beca_activa')}</Badge>}
                    {!f.matriculado && <Badge variant="destructive">{t('sin_matricula')}</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    aria-expanded={abierto === f.id}
                    aria-label={t(abierto === f.id ? 'detalle_ocultar' : 'detalle_ver', {
                      nombre: f.nombre,
                    })}
                    onClick={() => setAbierto(abierto === f.id ? null : f.id)}
                  >
                    {t(abierto === f.id ? 'detalle_ocultar_corto' : 'detalle_ver_corto')}
                  </Button>
                </TableCell>
                {panel.meses.map((m) => {
                  const b = f.meses[mesKey(m.anio, m.mes)]
                  const mes = etiquetaMes(locale, m.anio, m.mes)
                  return (
                    <TableCell key={mesKey(m.anio, m.mes)} className="text-center align-top">
                      {b ? (
                        <Badge
                          variant={VARIANTE[b.estado]}
                          className={cn('tabular-nums', b.excesoCentimos > 0 && MARCA_EXCESO)}
                          title={
                            t('celda', {
                              mes,
                              importe: eur(b.importeCentimos),
                              estado: t(`estado_${b.estado}`),
                            }) +
                            (b.excesoCentimos > 0 && b.via
                              ? ` · ${t(`exceso_${b.via}`, { importe: eur(b.excesoCentimos) })}`
                              : '')
                          }
                        >
                          {eur(b.importeCentimos)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground" title={t('sin_beca_mes', { mes })}>
                          {t('vacio')}
                        </span>
                      )}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right align-top tabular-nums">
                  {eur(f.totales.asignado)}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {eur(aplicado(f.totales))}
                </TableCell>
                <TableCell className="text-right align-top font-medium tabular-nums">
                  {eur(queda(f.totales))}
                </TableCell>
              </TableRow>
              {abierto === f.id && (
                <TableRow>
                  <TableCell colSpan={nCols} className="bg-muted/40">
                    <Detalle fila={f} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{etiqueta}</dt>
      <dd className="text-lg font-semibold tabular-nums">{valor}</dd>
    </div>
  )
}

function Detalle({ fila }: { fila: FilaPanel }) {
  const t = useTranslations('admin.cuotas.beca_comedor.panel')
  const locale = useLocale()
  const eur = (c: number) => formatEuros(c, locale)
  const becas = Object.values(fila.meses).sort(
    (a, b) =>
      a.anioCorrespondiente - b.anioCorrespondiente || a.mesCorrespondiente - b.mesCorrespondiente
  )

  function linea(b: BecaMes, resto: boolean) {
    const mesCorr = etiquetaMes(locale, b.anioCorrespondiente, b.mesCorrespondiente)
    const mesAplic = etiquetaMes(locale, b.anioAplicacion, b.mesAplicacion)
    return (
      <li key={b.tramoId} className="space-y-0.5">
        <div>
          {t(resto ? 'detalle_resto' : 'detalle_beca', {
            mes: mesCorr,
            importe: eur(b.importeCentimos),
          })}{' '}
          <span className="text-muted-foreground">
            {t(`detalle_${b.estado}`, { mes: mesAplic })}
          </span>
        </div>
        {b.excesoCentimos > 0 && b.via && (
          <div className="text-amber-700 dark:text-amber-400">
            {t(`exceso_${b.via}`, { importe: eur(b.excesoCentimos) })}
          </div>
        )}
      </li>
    )
  }

  const tot = fila.totales
  return (
    <div className="space-y-2 text-xs">
      {becas.length === 0 && fila.restos.length === 0 ? (
        <p className="text-muted-foreground">{t('detalle_sin_becas')}</p>
      ) : (
        <ul className="space-y-1">
          {becas.map((b) => linea(b, false))}
          {fila.restos.map((b) => linea(b, true))}
        </ul>
      )}
      <p className="text-muted-foreground">
        {t('desglose', {
          descontado: eur(tot.descontado),
          enRecibo: eur(tot.enRecibo),
          porAplicar: eur(tot.porAplicar),
          transferencia: eur(tot.transferencia),
          porResolver: eur(tot.porResolver),
        })}
      </p>
    </div>
  )
}
