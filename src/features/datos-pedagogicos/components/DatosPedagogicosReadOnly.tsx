import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { idiomasVisibles } from '@/shared/lib/idioma-centinela'

import type { DatosPedagogicosRow } from '../queries/get-datos-pedagogicos'

interface Props {
  data: DatosPedagogicosRow
}

/**
 * Vista read-only de los datos pedagógicos. La usan family y, en el futuro,
 * teacher cuando llegue Fase 3 con el contexto del niño.
 */
export async function DatosPedagogicosReadOnly({ data }: Props) {
  const t = await getTranslations('pedagogico')

  const idiomasStr = idiomasVisibles(data.idiomas_casa).join(', ').toUpperCase() || '—'
  const siestaNum = data.siesta_numero_diario === null ? '—' : String(data.siesta_numero_diario)
  // Sin contestar se dice así: con la clave hecha a mano, NULL pintaba «lactancia_opciones.null»
  // (C, 2026-11-24). Ni un valor por defecto ni la clave.
  const sinContestar = t('sin_contestar')
  const lactancia =
    data.lactancia_estado === null ? sinContestar : t(`lactancia_opciones.${data.lactancia_estado}`)
  const esfinteres =
    data.control_esfinteres === null
      ? sinContestar
      : t(`control_esfinteres_opciones.${data.control_esfinteres}`)
  const alimentacion =
    data.tipo_alimentacion === null
      ? sinContestar
      : t(`alimentacion_opciones.${data.tipo_alimentacion}`)

  return (
    <Card>
      <CardContent className="space-y-2 text-sm">
        <Row k={t('fields.lactancia_estado')} v={lactancia} />
        {data.lactancia_observaciones && (
          <Row k={t('fields.lactancia_observaciones')} v={data.lactancia_observaciones} />
        )}
        <Row k={t('fields.control_esfinteres')} v={esfinteres} />
        {data.control_esfinteres_observaciones && (
          <Row
            k={t('fields.control_esfinteres_observaciones')}
            v={data.control_esfinteres_observaciones}
          />
        )}
        <Row k={t('fields.siesta_horario_habitual')} v={data.siesta_horario_habitual ?? '—'} />
        <Row k={t('fields.siesta_numero_diario')} v={siestaNum} />
        {data.siesta_observaciones && (
          <Row k={t('fields.siesta_observaciones')} v={data.siesta_observaciones} />
        )}
        <Row k={t('fields.tipo_alimentacion')} v={alimentacion} />
        {data.alimentacion_observaciones && (
          <Row k={t('fields.alimentacion_observaciones')} v={data.alimentacion_observaciones} />
        )}
        <Row k={t('fields.idiomas_casa')} v={idiomasStr} />
        <Row
          k={t('fields.tiene_hermanos_en_centro')}
          v={data.tiene_hermanos_en_centro ? t('si') : t('no')}
        />
      </CardContent>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-dashed border-neutral-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-muted-foreground w-56 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
