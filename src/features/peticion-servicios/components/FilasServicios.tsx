'use client'

import { useTranslations } from 'next-intl'

import { formatEuros } from '@/shared/lib/format-money'

import type { FilaServicio, OpcionServicio, Servicio } from '../lib/peticion'

interface Props {
  locale: string
  filas: readonly FilaServicio[]
  /** El valor elegido en cada fila (`valorDe`), o nada si está sin contestar. */
  valores: Partial<Record<Servicio, string>>
  onChange: (servicio: Servicio, valor: string) => void
  /** Las filas sin contestar se marcan (al intentar seguir sin haberlas contestado). */
  marcarSinContestar?: boolean
  disabled?: boolean
}

/**
 * Fase 8b — una fila por servicio que el centro ofrece, con «No» y solo las opciones que existen:
 * cada mensual («Todos los meses», con su nombre y su precio al mes) y cada diario («Días
 * sueltos», con su precio al día). La lista la da la base (`servicios_alta`): aquí no se inventa
 * ninguna opción. Es una petición: lo dice el texto de arriba, y que «No» y «Días sueltos» no
 * cambian lo que se cobra si el niño se queda.
 */
export function FilasServicios({
  locale,
  filas,
  valores,
  onChange,
  marcarSinContestar = false,
  disabled = false,
}: Props) {
  const t = useTranslations('peticion_servicios')

  function precio(o: OpcionServicio, por: 'mes' | 'dia') {
    if (o.importeCentimos === null) return t('precio_sin_importe')
    return t(`precio_${por}`, { importe: formatEuros(o.importeCentimos, locale) })
  }

  return (
    <div className="space-y-4">
      {filas.map((f) => {
        const sinContestar = marcarSinContestar && !valores[f.servicio]
        const opciones: { valor: string; texto: string; detalle?: string }[] = [
          { valor: 'no', texto: t('opcion.no') },
          ...f.mensuales.map((o) => ({
            valor: `mensual:${o.conceptoId}`,
            texto: t('opcion.mensual'),
            detalle: `${o.nombre} · ${precio(o, 'mes')}`,
          })),
          ...f.diarios.map((o) => ({
            valor: `dias_sueltos:${o.conceptoId}`,
            texto: t('opcion.dias_sueltos'),
            detalle: f.diarios.length > 1 ? `${o.nombre} · ${precio(o, 'dia')}` : precio(o, 'dia'),
          })),
        ]
        return (
          <fieldset
            key={f.servicio}
            className={
              sinContestar
                ? 'border-destructive/50 space-y-2 rounded-lg border p-3'
                : 'space-y-2 rounded-lg border p-3'
            }
            aria-invalid={sinContestar || undefined}
            data-testid={`servicio-${f.servicio}`}
          >
            <legend className="px-1 text-sm font-semibold">{t(`servicio.${f.servicio}`)}</legend>
            <div className="flex flex-col gap-2">
              {opciones.map((o) => (
                <label
                  key={o.valor}
                  className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md p-1 text-sm"
                >
                  <input
                    type="radio"
                    name={`servicio-${f.servicio}`}
                    value={o.valor}
                    checked={valores[f.servicio] === o.valor}
                    onChange={() => onChange(f.servicio, o.valor)}
                    disabled={disabled}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{o.texto}</span>
                    {o.detalle && <span className="text-muted-foreground"> · {o.detalle}</span>}
                  </span>
                </label>
              ))}
            </div>
            {sinContestar && <p className="text-destructive text-xs">{t('sin_contestar_fila')}</p>}
          </fieldset>
        )
      })}
    </div>
  )
}
