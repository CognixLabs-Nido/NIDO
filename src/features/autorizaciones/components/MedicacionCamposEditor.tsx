'use client'

import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { MedicacionDatos } from '../types'

interface Props {
  value: MedicacionDatos
  onChange: (m: MedicacionDatos) => void
  disabled?: boolean
}

/**
 * Editor de los campos estructurados de una medicación (F8-3a): medicamento,
 * dosis, vía, pauta/frecuencia y fechas de inicio/fin (= vigencia). Se firman y
 * se atan al hash. No conoce el flujo de firma (lo orquesta el diálogo/panel).
 */
export function MedicacionCamposEditor({ value, onChange, disabled }: Props) {
  const t = useTranslations('autorizaciones')

  function set(campo: keyof MedicacionDatos, v: string) {
    onChange({ ...value, [campo]: v })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="med-medicamento">{t('medicacion.medicamento')}</Label>
          <Input
            id="med-medicamento"
            value={value.medicamento}
            onChange={(e) => set('medicamento', e.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder={t('medicacion.medicamento_placeholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="med-dosis">{t('medicacion.dosis')}</Label>
          <Input
            id="med-dosis"
            value={value.dosis}
            onChange={(e) => set('dosis', e.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder={t('medicacion.dosis_placeholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="med-via">{t('medicacion.via')}</Label>
          <Input
            id="med-via"
            value={value.via ?? ''}
            onChange={(e) => set('via', e.target.value)}
            maxLength={100}
            disabled={disabled}
            placeholder={t('medicacion.via_placeholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="med-pauta">{t('medicacion.pauta')}</Label>
          <Input
            id="med-pauta"
            value={value.pauta}
            onChange={(e) => set('pauta', e.target.value)}
            maxLength={300}
            disabled={disabled}
            placeholder={t('medicacion.pauta_placeholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="med-inicio">{t('medicacion.fecha_inicio')}</Label>
          <Input
            id="med-inicio"
            type="date"
            value={value.fecha_inicio}
            onChange={(e) => set('fecha_inicio', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="med-fin">{t('medicacion.fecha_fin')}</Label>
          <Input
            id="med-fin"
            type="date"
            value={value.fecha_fin}
            onChange={(e) => set('fecha_fin', e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t('medicacion.vigencia_ayuda')}</p>
    </div>
  )
}
