import { CheckCircle2Icon, MinusCircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { localeIntl } from '@/shared/lib/locale-intl'

import type { LineaAvance } from '../lib/avance-alta'
import { ActivarMatriculaButton } from './ActivarMatriculaButton'
import { AltaSinTerminarAcciones } from './AltaSinTerminarAcciones'
import { ChecklistAvance } from './ChecklistAvance'

interface Props {
  estado: 'pendiente' | 'lista'
  matriculaId: string
  /**
   * Lo que lleva hecho el alta (`getAvanceAltas`), lo mismo que enseña la lista de altas en
   * proceso. NULL si no se pudo leer.
   */
  avance: LineaAvance[] | null
  /** Datos pedagógicos: opcionales y no son un consentimiento. Se enseñan aparte, neutros. */
  pedagogicos: boolean
  /** El alta sin terminar (`altas_sin_terminar`, 20261209120000): solo con la matrícula pendiente. */
  sinTerminar?: {
    ninoId: string
    estado: 'invitacion_abierta' | 'sin_invitacion' | 'iniciada'
    desde: string | null
    propuesta: boolean
    email: string | null
    familiaNueva: boolean
  }
  locale: string
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
  avance,
  pedagogicos,
  sinTerminar,
  locale,
}: Props) {
  const t = await getTranslations('admin.ninos.avance_alta')
  const tS = await getTranslations('admin.ninos.sin_terminar')
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(localeIntl(locale), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso))

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
        <ChecklistAvance avance={avance} variante="lista" />
        <p className="flex items-center gap-2 text-sm">
          {pedagogicos ? (
            <CheckCircle2Icon className="text-success-700 size-4 shrink-0" strokeWidth={2} />
          ) : (
            <MinusCircleIcon className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
          )}
          <span className={pedagogicos ? '' : 'text-muted-foreground'}>
            {t('items.pedagogicos')}
            {!pedagogicos && <span className="text-muted-foreground"> · {t('sin_datos')}</span>}
          </span>
        </p>
        {estado === 'lista' ? (
          <div className="space-y-1 border-t pt-3">
            <ActivarMatriculaButton matriculaId={matriculaId} />
            <p className="text-muted-foreground text-xs">{t('activar_ayuda')}</p>
          </div>
        ) : (
          <p className="text-muted-foreground border-t pt-3 text-xs">{t('pendiente_ayuda')}</p>
        )}
        {estado === 'pendiente' && sinTerminar && (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1">
              <p className="text-sm">
                {sinTerminar.estado === 'invitacion_abierta'
                  ? tS('estado.invitacion_abierta', { email: sinTerminar.email ?? '—' })
                  : sinTerminar.estado === 'sin_invitacion'
                    ? tS('estado.sin_invitacion', {
                        email: sinTerminar.email ?? '—',
                        fecha: sinTerminar.desde ? fecha(sinTerminar.desde) : '—',
                      })
                    : tS('estado.iniciada', {
                        fecha: sinTerminar.desde ? fecha(sinTerminar.desde) : '—',
                      })}
              </p>
              {sinTerminar.propuesta && <Badge variant="warning">{tS('propuesta')}</Badge>}
            </div>
            <AltaSinTerminarAcciones
              ninoId={sinTerminar.ninoId}
              estado={sinTerminar.estado}
              email={sinTerminar.email}
              familiaNueva={sinTerminar.familiaNueva}
              locale={locale}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
