import { getTranslations } from 'next-intl/server'

import { COLORES_TIPO, TIPOS_ORDEN } from '../lib/colores-tipo'

/**
 * Leyenda de los 7 tipos de día con sus colores.
 *
 * Visible SIEMPRE bajo el calendario (admin, profe, familia). Es la
 * única forma de que cada color signifique algo para quien mira el
 * grid — un tooltip oculto rompería la accesibilidad y la usabilidad.
 */
export async function LeyendaTiposDia() {
  const t = await getTranslations('calendario')

  return (
    <section
      aria-label={t('leyenda.title')}
      data-testid="leyenda-tipos-dia"
      className="bg-card border-border/60 mt-4 rounded-2xl border p-4 shadow-sm"
    >
      <header className="mb-2 flex flex-col gap-1">
        <h3 className="text-foreground text-sm font-semibold">{t('leyenda.title')}</h3>
        <p className="text-muted-foreground text-xs">{t('leyenda.intro')}</p>
      </header>
      <ul className="flex flex-wrap gap-2">
        {TIPOS_ORDEN.map((tipo) => (
          <li key={tipo}>
            <span
              data-testid={`leyenda-chip-${tipo}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${COLORES_TIPO[tipo].chip}`}
            >
              <span aria-hidden="true" className="size-2 rounded-full bg-current" />
              {t(`tipos.${tipo}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
