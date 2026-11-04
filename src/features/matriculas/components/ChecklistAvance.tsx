import { CheckCircle2Icon, CircleIcon, MinusCircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import type { LineaAvance } from '../lib/avance-alta'

interface Props {
  avance: LineaAvance[] | null
  /** `fila`: en línea, para la lista; `lista`: una por renglón, para la ficha. */
  variante?: 'fila' | 'lista'
}

/**
 * Lo que lleva hecho el alta (`avance-alta.ts`), igual en la lista de altas en proceso y en la
 * ficha del niño. Hecho: check verde. Lo que falta: círculo. Lo opcional sin hacer: guion neutro,
 * para que no parezca que falta. Sin datos (`null`): se dice que no se pudo leer, nunca «falta».
 */
export async function ChecklistAvance({ avance, variante = 'fila' }: Props) {
  const t = await getTranslations('admin.altas.avance')
  if (!avance) return <p className="text-muted-foreground text-sm">{t('no_se_pudo_leer')}</p>

  return (
    <ul
      aria-label={t('titulo')}
      className={variante === 'fila' ? 'flex flex-wrap gap-x-3 gap-y-1' : 'space-y-1.5'}
    >
      {avance.map(({ item, estado }) => {
        const Icon =
          estado === 'hecho'
            ? CheckCircle2Icon
            : estado === 'sin_hacer_opcional'
              ? MinusCircleIcon
              : CircleIcon
        return (
          <li key={item} className="flex items-center gap-1.5 text-sm">
            <Icon
              aria-hidden
              className={`${estado === 'hecho' ? 'text-success-700' : 'text-muted-foreground'} size-4 shrink-0`}
              strokeWidth={estado === 'hecho' ? 2 : 1.75}
            />
            <span className={estado === 'hecho' ? '' : 'text-muted-foreground'}>
              {t(`items.${item}`)}
              <span className="sr-only"> · {t(`estado.${estado}`)}</span>
              {estado === 'sin_hacer_opcional' && (
                <span className="text-muted-foreground" aria-hidden>
                  {' '}
                  · {t('opcional')}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
