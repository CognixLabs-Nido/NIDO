import { useTranslations } from 'next-intl'

import { esCodigoFalta } from '../lib/falta'
import type { Falta } from '../queries/get-peticiones'

/**
 * Lo que falta de una petición pendiente: los bloqueos (impiden confirmar) y los avisos. La titular
 * y la familia ven lo mismo: son datos de la propia familia.
 */
export function FaltaLista({ falta }: { falta: Falta }) {
  const tipada = useTranslations('olvido.falta')
  const tMotivo = useTranslations('datos_bloqueados.motivos') as unknown as (
    clave: string
  ) => string
  // El código viene de la BD (ya comprobado con `esCodigoFalta`), y unos textos llevan `{n}` y
  // otros no: se ensancha la firma en un solo sitio.
  const t = tipada as unknown as (
    clave: string,
    valores?: Record<string, number | string>
  ) => string
  // La retención dice por qué tipo de motivo; el texto del motivo se queda en el centro.
  const texto = (i: { codigo: string; n: number; motivo_tipo?: string }) =>
    i.codigo === 'retenido'
      ? t('retenido', { motivo: i.motivo_tipo ? tMotivo(i.motivo_tipo) : t('retenido_sin_motivo') })
      : t(i.codigo, { n: i.n })
  const bloqueos = falta.bloqueos.filter((b) => esCodigoFalta(b.codigo))
  const avisos = falta.avisos.filter((a) => esCodigoFalta(a.codigo))
  if (bloqueos.length === 0 && avisos.length === 0) return null

  return (
    <div className="space-y-2 text-sm">
      {bloqueos.length > 0 && (
        <div>
          <p className="text-destructive text-xs font-medium">{t('titulo_bloqueos')}</p>
          <ul className="list-disc pl-5">
            {bloqueos.map((b) => (
              <li key={b.codigo}>{texto(b)}</li>
            ))}
          </ul>
        </div>
      )}
      {avisos.length > 0 && (
        <div>
          <p className="text-muted-foreground text-xs font-medium">{t('titulo_avisos')}</p>
          <ul className="text-muted-foreground list-disc pl-5">
            {avisos.map((a) => (
              <li key={a.codigo}>{texto(a)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
