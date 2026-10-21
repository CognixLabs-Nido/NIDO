import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { alertasDe } from '../lib/alertas'
import type { MetricasCentro } from '../types'

import { EntrarEnCentro } from './EntrarEnCentro'

interface Props {
  centro: MetricasCentro
  locale: string
}

/** Los recuentos que se pintan, en orden, con su clave de `plataforma.metricas`. */
export const RECUENTOS = [
  ['ninos_matriculados', 'ninosMatriculados'],
  ['ninos_en_alta', 'ninosEnAlta'],
  ['familias', 'familias'],
  ['personal', 'personal'],
  ['personal_baja_temporal', 'personalBajaTemporal'],
  ['direccion', 'direccion'],
  ['aulas', 'aulas'],
  ['invitaciones_pendientes', 'invitacionesPendientes'],
] as const satisfies ReadonlyArray<readonly [string, keyof MetricasCentro]>

/** Un centro en el panel: sus alertas, sus recuentos y el botón de entrar. Solo cifras. */
export function TarjetaCentro({ centro, locale }: Props) {
  const t = useTranslations('plataforma')
  const alertas = alertasDe(centro)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>{centro.nombre}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {centro.cursoActivo
              ? t('curso_activo', { curso: centro.cursoActivo })
              : t('sin_curso_activo_corto')}
          </p>
        </div>
        <EntrarEnCentro locale={locale} centroId={centro.centroId} />
      </CardHeader>
      <CardContent className="space-y-4">
        {alertas.length > 0 && (
          <ul className="space-y-1" aria-label={t('alertas.titulo')}>
            {alertas.map((a) => (
              <li
                key={a}
                className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {t(`alertas.${a}`)}
              </li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {RECUENTOS.map(([clave, campo]) => (
            <div key={clave}>
              <dt className="text-muted-foreground text-xs">{t(`metricas.${clave}`)}</dt>
              <dd className="text-lg font-semibold tabular-nums">{centro[campo]}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
