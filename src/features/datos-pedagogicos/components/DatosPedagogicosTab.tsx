'use client'

import { BookOpenIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

import { DatosPedagogicosForm } from './DatosPedagogicosForm'
import type { DatosPedagogicosInput } from '../schemas/datos-pedagogicos'

interface Props {
  ninoId: string
  locale: string
  initial: DatosPedagogicosInput | null
}

/**
 * Wrapper de la tab Pedagógico en el detalle del niño (admin).
 *
 * - Si no hay fila previa, muestra EmptyState con CTA. Al pulsar CTA monta
 *   el formulario en blanco.
 * - Si hay fila, muestra directamente el formulario prerrelleno.
 *
 * El form maneja el upsert; tras un guardado correcto el toast aparece y
 * `revalidatePath` refresca esta página en el server.
 */
export function DatosPedagogicosTab({ ninoId, locale, initial }: Props) {
  const t = useTranslations('pedagogico')
  const [creating, setCreating] = useState(false)

  if (!initial && !creating) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<BookOpenIcon strokeWidth={1.75} />}
            title={t('vacio_title')}
            description={t('vacio_descripcion')}
            cta={{
              label: t('vacio_cta'),
              onClick: () => setCreating(true),
            }}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent>
        <DatosPedagogicosForm ninoId={ninoId} locale={locale} initial={initial} />
      </CardContent>
    </Card>
  )
}
