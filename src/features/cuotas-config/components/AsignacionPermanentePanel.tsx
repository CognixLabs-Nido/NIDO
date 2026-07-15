'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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

import { proponerAsignaciones } from '../actions/proponer-asignaciones'
import type { AsignacionPermanente } from '../queries/get-asignacion-permanente'
import { ConfigurarModalidadDialog } from './ConfigurarModalidadDialog'
import { FamiliaConceptosDialog } from './FamiliaConceptosDialog'

interface Props {
  centroId: string
  data: AsignacionPermanente
}

// F-4-4: asignación PERMANENTE (sin mes, sin método) de conceptos por ALUMNO y por FAMILIA.
// Botón para sembrar las asignaciones automáticas (proponer_asignaciones).
export function AsignacionPermanentePanel({ centroId, data }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  function proponer() {
    startTransition(async () => {
      const r = await proponerAsignaciones()
      if (r.success) toast.success(t('proponer_ok', { n: r.data.propuestas }))
      else toast.error(tErrors(r.error))
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t('asignacion_permanente_desc')}</p>
        <Button variant="outline" disabled={pending} onClick={proponer}>
          {t('proponer')}
        </Button>
      </div>

      {/* Conceptos por ALUMNO */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t('seccion_alumnos')}</h2>
        {data.alumnos.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-center text-sm">{t('sin_ninos')}</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('fields.nino')}</TableHead>
                    <TableHead>{t('col_familia')}</TableHead>
                    <TableHead className="text-right">{t('fields.conceptos')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.alumnos.map((a) => (
                    <TableRow key={a.ninoId}>
                      <TableCell className="font-medium">{a.nombre}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{a.familiaEtiqueta}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-muted-foreground text-xs">
                            {t('conceptos_asignados', { n: a.conceptosAsignados.length })}
                          </span>
                          <ConfigurarModalidadDialog
                            centroId={centroId}
                            ninoId={a.ninoId}
                            ninoNombre={a.nombre}
                            conceptos={data.conceptosNino}
                            conceptosAsignados={a.conceptosAsignados}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </section>

      {/* Conceptos por FAMILIA */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t('seccion_familias')}</h2>
        <p className="text-muted-foreground text-xs">{t('seccion_familias_desc')}</p>
        {data.familias.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-center text-sm">{t('sin_familias')}</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_familia')}</TableHead>
                    <TableHead className="text-right">{t('fields.conceptos')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.familias.map((f) => (
                    <TableRow key={f.familiaId}>
                      <TableCell>
                        <div className="font-medium">{f.etiqueta}</div>
                        {f.tutores.length > 0 && (
                          <div className="text-muted-foreground text-xs">{f.tutores.join(' · ')}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-muted-foreground text-xs">
                            {t('conceptos_asignados', { n: f.conceptosAsignados.length })}
                          </span>
                          <FamiliaConceptosDialog
                            centroId={centroId}
                            familiaId={f.familiaId}
                            familiaEtiqueta={f.etiqueta}
                            conceptos={data.conceptosFamilia}
                            conceptosAsignados={f.conceptosAsignados}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}
