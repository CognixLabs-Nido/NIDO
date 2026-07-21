import { CheckCircle2Icon, CircleIcon, MinusCircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { ActivarMatriculaButton } from './ActivarMatriculaButton'

interface Props {
  estado: 'pendiente' | 'lista'
  matriculaId: string
  identidad: boolean
  pedagogicos: boolean
  medico: boolean
  imagen: boolean
}

/**
 * Pieza 3c — tarjeta de avance del alta para la **dirección** (vista admin del niño).
 * Muestra el checklist de lo que el tutor ha completado y el estado de la matrícula:
 *  - `'pendiente'`: el tutor aún rellena el alta (no activable — el guard exige `'lista'`).
 *  - `'lista'`: el tutor finalizó → botón **Activar** (`'lista' → 'activa'`).
 * (`'activa'` no llega aquí: la página muestra el aula.)
 */
export async function AvanceAltaCard({
  estado,
  matriculaId,
  identidad,
  pedagogicos,
  medico,
  imagen,
}: Props) {
  const t = await getTranslations('admin.ninos.avance_alta')

  // `informativo`: dato opcional que NO es un consentimiento (datos pedagógicos). Ausente NO es
  // "no autorizado" ni bloquea: se muestra neutro ("sin datos"), distinto del círculo de pendiente.
  const items: { label: string; done: boolean; opcional?: boolean; informativo?: boolean }[] = [
    { label: t('items.identidad'), done: identidad },
    { label: t('items.pedagogicos'), done: pedagogicos, informativo: true },
    { label: t('items.medico'), done: medico, opcional: true },
    { label: t('items.imagen'), done: imagen, opcional: true },
  ]

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('titulo')}</CardTitle>
        {estado === 'lista' ? (
          <Badge variant="success">{t('estado.lista')}</Badge>
        ) : (
          <Badge variant="info">{t('estado.pendiente')}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {items.map((it) => {
            // Icono: hecho → check verde; informativo sin dato → guion neutro (n/a, no pendiente);
            // resto sin hacer → círculo de pendiente.
            const Icon = it.done ? CheckCircle2Icon : it.informativo ? MinusCircleIcon : CircleIcon
            return (
              <li key={it.label} className="flex items-center gap-2 text-sm">
                <Icon
                  className={`${it.done ? 'text-success-700' : 'text-muted-foreground'} size-4 shrink-0`}
                  strokeWidth={it.done ? 2 : 1.75}
                />
                <span className={it.done ? '' : 'text-muted-foreground'}>
                  {it.label}
                  {it.informativo && !it.done && (
                    <span className="text-muted-foreground"> · {t('sin_datos')}</span>
                  )}
                  {it.opcional && <span className="text-muted-foreground"> · {t('opcional')}</span>}
                </span>
              </li>
            )
          })}
        </ul>
        {estado === 'lista' ? (
          <div className="space-y-1 border-t pt-3">
            <ActivarMatriculaButton matriculaId={matriculaId} />
            <p className="text-muted-foreground text-xs">{t('activar_ayuda')}</p>
          </div>
        ) : (
          <p className="text-muted-foreground border-t pt-3 text-xs">{t('pendiente_ayuda')}</p>
        )}
      </CardContent>
    </Card>
  )
}
