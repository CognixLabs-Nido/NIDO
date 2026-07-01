'use client'

import { useState, useTransition } from 'react'
import { AlertTriangleIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { MesSelector } from '@/features/cuotas-config/components/MesSelector'
import { formatEuros } from '@/shared/lib/format-money'

import { crearRemesa } from '../actions/crear-remesa'
import { marcarRemesaEnviada } from '../actions/marcar-remesa-enviada'
import type { DatosAcreedorConfig } from '../queries/get-datos-acreedor'
import type { ReciboGestion } from '../queries/get-recibos-gestion'
import type { ReciboSepaRemesable } from '../queries/get-recibos-sepa-remesables'
import type { RemesaListItem } from '../queries/get-remesas-mes'
import { DatosAcreedorDialog } from './DatosAcreedorDialog'
import { DevolucionesPanel } from './DevolucionesPanel'
import { RemesaXmlButton } from './RemesaXmlButton'

interface Props {
  anio: number
  mes: number
  acreedor: DatosAcreedorConfig
  recibos: ReciboSepaRemesable[]
  remesas: RemesaListItem[]
  recibosGestion: ReciboGestion[]
}

export function RemesasPanel({ anio, mes, acreedor, recibos, remesas, recibosGestion }: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const acreedorCompleto = Boolean(acreedor.identificadorAcreedor && acreedor.ibanConfigurado)
  const seleccionables = recibos.filter((r) => r.tieneMandato)

  function toggle(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTodos() {
    setSeleccion((prev) =>
      prev.size === seleccionables.length ? new Set() : new Set(seleccionables.map((r) => r.id))
    )
  }

  function crear() {
    startTransition(async () => {
      const r = await crearRemesa({ anio, mes, reciboIds: [...seleccion] })
      if (r.success) {
        toast.success(t('remesa_creada'))
        setSeleccion(new Set())
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function enviar(remesaId: string) {
    startTransition(async () => {
      const r = await marcarRemesaEnviada({ remesaId })
      if (r.success) toast.success(t('remesa_enviada'))
      else toast.error(tErrors(r.error))
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MesSelector anio={anio} mes={mes} tab="remesas" />
      </div>

      {/* Config del acreedor */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground text-base font-semibold">{t('acreedor_title')}</h2>
          <DatosAcreedorDialog
            config={acreedor}
            trigger={
              <Button variant="outline" size="sm">
                <PencilIcon /> {t('acreedor_editar')}
              </Button>
            }
          />
        </div>
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('fields.identificador_acreedor')}</dt>
            <dd>
              {acreedor.identificadorAcreedor ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('fields.bic_acreedor')}</dt>
            <dd>
              {acreedor.bicAcreedor ?? <span className="text-muted-foreground">NOTPROVIDED</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('fields.iban_acreedor')}</dt>
            <dd>
              {acreedor.ibanConfigurado ? (
                <Badge variant="secondary">{t('iban_configurado')}</Badge>
              ) : (
                <span className="text-muted-foreground">{t('iban_sin_configurar')}</span>
              )}
            </dd>
          </div>
        </dl>
        {!acreedorCompleto && (
          <p className="flex items-center gap-1 text-sm text-amber-600">
            <AlertTriangleIcon className="size-4" /> {t('acreedor_incompleto_aviso')}
          </p>
        )}
      </Card>

      {/* Marcado de recibos SEPA */}
      <Card className="space-y-3 p-5">
        <h2 className="text-foreground text-base font-semibold">{t('marcar_title')}</h2>
        {recibos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_recibos_sepa')}</p>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              <label className="flex items-center gap-3 p-2 text-sm font-medium">
                <Checkbox
                  checked={seleccion.size > 0 && seleccion.size === seleccionables.length}
                  onCheckedChange={toggleTodos}
                  disabled={seleccionables.length === 0}
                />
                {t('seleccionar_todos')}
              </label>
              {recibos.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center justify-between gap-3 p-2 text-sm"
                  data-disabled={!r.tieneMandato}
                >
                  <span className="flex items-center gap-3">
                    <Checkbox
                      checked={seleccion.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      disabled={!r.tieneMandato}
                    />
                    <span>
                      {r.ninoNombre || r.ninoId}
                      {r.esEsporadico && (
                        <Badge variant="outline" className="ml-2">
                          {t('esporadico')}
                        </Badge>
                      )}
                      {!r.tieneMandato && (
                        <Badge variant="warm" className="ml-2">
                          {t('sin_mandato_badge')}
                        </Badge>
                      )}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatEuros(r.totalCentimos)}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-sm">
                {t('seleccionados', { num: seleccion.size })}
              </span>
              <Button onClick={crear} disabled={pending || seleccion.size === 0}>
                {t('crear_remesa')}
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Remesas del periodo */}
      <Card className="space-y-3 p-5">
        <h2 className="text-foreground text-base font-semibold">{t('remesas_title')}</h2>
        {remesas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_remesas')}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {remesas.map((rm) => (
              <div
                key={rm.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {rm.estado === 'enviada' ? (
                      <Badge variant="secondary">{t('estado.enviada')}</Badge>
                    ) : (
                      <Badge variant="warm">{t('estado.borrador')}</Badge>
                    )}
                    <span className="text-muted-foreground">
                      {t('remesa_resumen', {
                        num: rm.numRecibos,
                        total: formatEuros(rm.totalCentimos),
                      })}
                    </span>
                  </div>
                  {rm.fechaEnvioBanco && (
                    <p className="text-muted-foreground text-xs">
                      {t('enviada_el', { fecha: rm.fechaEnvioBanco })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RemesaXmlButton remesaId={rm.id} disabled={!acreedorCompleto} />
                  {rm.estado === 'borrador' && (
                    <Button size="sm" disabled={pending} onClick={() => enviar(rm.id)}>
                      {t('marcar_enviada')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <DevolucionesPanel recibos={recibosGestion} />
    </div>
  )
}
