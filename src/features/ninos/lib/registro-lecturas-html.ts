import { localeIntl } from '@/shared/lib/locale-intl'

import type { LecturaFichaMedica } from '../queries/get-lecturas-ficha-medica'

/** Traductor del namespace `ficha_medica_lecturas` (lo pasa la route con el locale de quien descarga). */
export type Etiquetador = (key: string) => string

export interface RegistroParaEntregar {
  /** Nombre y apellidos del niño, como los tiene el centro. */
  nino: string
  generadoEn: Date
  lecturas: LecturaFichaMedica[]
}

/**
 * El registro de quién ha leído la ficha médica de un niño, en un HTML que se entrega a la familia
 * (derecho de acceso, art. 15 RGPD) y se puede imprimir. Por cada lectura, lo que pide el art. 9 del
 * Reglamento (UE) 2025/327: quién accedió, la fecha y la hora, y qué datos consultó. Además, en
 * calidad de qué y desde dónde.
 *
 * La hora va en la de Madrid con su zona escrita (CET/CEST) y, en el `datetime`, en UTC: una hora
 * sin zona en un documento que se entrega no se puede contrastar.
 */
export function renderRegistroLecturasHtml(
  r: RegistroParaEntregar,
  t: Etiquetador,
  locale: string
): string {
  const fmt = new Intl.DateTimeFormat(localeIntl(locale), {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
  const fecha = (d: Date) =>
    `<time datetime="${escape(d.toISOString())}">${escape(fmt.format(d))}</time>`

  const filas = r.lecturas
    .map((l) => {
      const campos =
        l.campos.length === 0 ? t('sin_datos') : l.campos.map((c) => t(`campo.${c}`)).join(', ')
      return `<tr>
<td>${fecha(new Date(l.leidaEn))}</td>
<td>${escape(l.lector ?? t('cuenta_borrada'))}</td>
<td>${escape(t(`rol.${l.rol}`))}</td>
<td>${escape(t(`origen.${l.origen}`))}</td>
<td>${escape(campos)}</td>
</tr>`
    })
    .join('\n')

  const cuerpo =
    r.lecturas.length === 0
      ? `<p>${escape(t('vacio'))}</p>`
      : `<table>
<thead><tr>
<th>${escape(t('documento.col_fecha'))}</th>
<th>${escape(t('documento.col_quien'))}</th>
<th>${escape(t('documento.col_rol'))}</th>
<th>${escape(t('documento.col_origen'))}</th>
<th>${escape(t('documento.col_campos'))}</th>
</tr></thead>
<tbody>
${filas}
</tbody>
</table>`

  return `<!doctype html>
<html lang="${escape(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(t('documento.titulo'))} · ${escape(r.nino)}</title>
<style>
body { font-family: system-ui, sans-serif; color: #1a1a1a; background: #fff; margin: 2rem; line-height: 1.45; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
p { margin: .25rem 0; }
.meta { color: #555; font-size: .9rem; }
table { border-collapse: collapse; width: 100%; margin-top: 1.25rem; font-size: .9rem; }
th, td { border: 1px solid #ccc; padding: .4rem .55rem; text-align: left; vertical-align: top; }
th { background: #f3f3f3; }
@media print { body { margin: 1cm; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escape(t('documento.titulo'))}</h1>
<p><strong>${escape(t('documento.nino'))}:</strong> ${escape(r.nino)}</p>
<p class="meta">${escape(t('documento.generado'))}: ${fecha(r.generadoEn)}</p>
<p>${escape(t('documento.intro'))}</p>
${cuerpo}
</body>
</html>
`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
