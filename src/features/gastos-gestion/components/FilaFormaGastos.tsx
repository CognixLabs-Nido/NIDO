'use client'

import { useTranslations } from 'next-intl'

import { formatEuros } from '@/shared/lib/format-money'

import {
  ACCEPT_JUSTIFICANTE,
  FORMAS_GASTOS,
  type FormaGastos,
  type GastosCurso,
} from '../lib/gastos'

interface Props {
  locale: string
  gastos: GastosCurso
  forma: FormaGastos | null
  onForma: (f: FormaGastos) => void
  onJustificante: (f: File | null) => void
  marcarSinContestar?: boolean
  disabled?: boolean
}

/**
 * Fase 9 — los gastos de gestión de un curso: el importe, y cómo paga la familia (transferencia,
 * con el justificante ahora o después, o efectivo). Con importe 0 no hay nada que contestar.
 */
export function FilaFormaGastos({
  locale,
  gastos,
  forma,
  onForma,
  onJustificante,
  marcarSinContestar = false,
  disabled = false,
}: Props) {
  const t = useTranslations('gastos_gestion')
  const sinContestar = marcarSinContestar && gastos.importe > 0 && forma === null
  return (
    <fieldset
      className={
        sinContestar
          ? 'border-destructive/50 space-y-2 rounded-lg border p-3'
          : 'space-y-2 rounded-lg border p-3'
      }
      aria-invalid={sinContestar || undefined}
      data-testid={`gastos-${gastos.cursoId}`}
    >
      <legend className="px-1 text-sm font-semibold">
        {t('curso', { curso: gastos.cursoNombre })}
      </legend>
      <p className="text-sm">{t('importe', { importe: formatEuros(gastos.importe, locale) })}</p>
      {gastos.importe === 0 ? (
        <p className="text-muted-foreground text-sm">{t('importe_cero')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {FORMAS_GASTOS.map((f) => (
            <label
              key={f}
              className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md p-1 text-sm"
            >
              <input
                type="radio"
                name={`gastos-${gastos.cursoId}`}
                value={f}
                checked={forma === f}
                onChange={() => onForma(f)}
                disabled={disabled}
                className="mt-1"
              />
              <span className="font-medium">{t(`opcion.${f}`)}</span>
            </label>
          ))}
          {forma === 'transferencia' && (
            <div className="space-y-1 pl-6">
              {gastos.justificantePath && (
                <p className="text-muted-foreground text-xs">{t('justificante_ya')}</p>
              )}
              <label className="block text-sm">
                <span className="text-muted-foreground block text-xs">
                  {t('justificante_ayuda')}
                </span>
                <input
                  type="file"
                  accept={ACCEPT_JUSTIFICANTE}
                  onChange={(e) => onJustificante(e.target.files?.[0] ?? null)}
                  disabled={disabled}
                  aria-label={t('justificante')}
                  className="mt-1 text-sm"
                />
              </label>
            </div>
          )}
        </div>
      )}
      {sinContestar && <p className="text-destructive text-xs">{t('sin_contestar')}</p>}
    </fieldset>
  )
}
