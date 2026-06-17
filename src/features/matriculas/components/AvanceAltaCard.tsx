import { CheckCircle2Icon, CircleIcon } from 'lucide-react'
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

  const items: { label: string; done: boolean; opcional?: boolean }[] = [
    { label: t('items.identidad'), done: identidad },
    { label: t('items.pedagogicos'), done: pedagogicos, opcional: true },
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
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-2 text-sm">
              {it.done ? (
                <CheckCircle2Icon className="text-success-700 size-4 shrink-0" strokeWidth={2} />
              ) : (
                <CircleIcon className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
              )}
              <span className={it.done ? '' : 'text-muted-foreground'}>
                {it.label}
                {it.opcional && <span className="text-muted-foreground"> · {t('opcional')}</span>}
              </span>
            </li>
          ))}
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
