'use client'

import type { Control } from 'react-hook-form'
import { useTranslations } from 'next-intl'

import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import type { InfoMedicaInput } from '../schemas/nino'

const CAMPOS: { name: keyof InfoMedicaInput; textarea?: boolean }[] = [
  { name: 'alergias_graves', textarea: true },
  { name: 'notas_emergencia', textarea: true },
  { name: 'medicacion_habitual', textarea: true },
  { name: 'alergias_leves', textarea: true },
  { name: 'medico_familia' },
  { name: 'telefono_emergencia' },
]

/**
 * Campos compartidos de la ficha médica (los 6: alergias_graves, notas_emergencia,
 * medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia). Lo usan
 * tanto el `PasoMedico` del wizard de alta como `EditarInfoMedica` en la ficha de
 * familia, para que ambos rendericen exactamente el mismo set de campos. Cada consumidor
 * aporta su propio `form`, su `onSubmit` y sus botones.
 */
export function InfoMedicaFields({ control }: { control: Control<InfoMedicaInput> }) {
  const tNino = useTranslations('admin.ninos')

  return (
    <>
      {CAMPOS.map(({ name, textarea }) => (
        <FormField
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino(`fields.${name}`)}</FormLabel>
              <FormControl>
                {textarea ? (
                  <Textarea rows={2} {...field} value={field.value ?? ''} />
                ) : (
                  <Input {...field} value={field.value ?? ''} />
                )}
              </FormControl>
            </FormItem>
          )}
        />
      ))}
    </>
  )
}
