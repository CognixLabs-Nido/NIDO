import 'server-only'

import type { DocumentoExport } from '../types'

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render genérico y recursivo del documento (robusto ante cambios de forma). */
function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '<span class="nil">—</span>'
  if (Array.isArray(v)) {
    if (v.length === 0) return '<span class="nil">— (vacío)</span>'
    return `<ul>${v.map((x) => `<li>${renderValue(x)}</li>`).join('')}</ul>`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '<span class="nil">—</span>'
    return `<dl>${entries
      .map(([k, val]) => `<dt>${escape(k)}</dt><dd>${renderValue(val)}</dd>`)
      .join('')}</dl>`
  }
  return escape(String(v))
}

/**
 * Copia HTML legible del export (#1). Render genérico del mismo objeto que
 * `datos.json`, para que una familia no-tech pueda leerlo en el navegador.
 */
export function renderExportHtml(doc: DocumentoExport): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tus datos — NIDO</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.6rem; } h2 { margin-top: 2rem; border-bottom: 2px solid #eee; padding-bottom: .3rem; }
  dl { margin: .3rem 0 .3rem 1rem; } dt { font-weight: 600; color: #444; margin-top: .4rem; }
  dd { margin: 0 0 0 1rem; } ul { margin: .2rem 0 .2rem 1rem; }
  .nil { color: #999; } .meta { background: #f6f8fa; padding: 1rem; border-radius: .5rem; }
  .aviso { background: #fff8e1; padding: .75rem 1rem; border-radius: .5rem; margin: 1rem 0; }
</style>
</head>
<body>
<h1>Copia de tus datos personales — NIDO</h1>
<div class="meta">${renderValue(doc._meta)}</div>
<div class="aviso">Los enlaces a archivos (fotos, documentos) caducan a las ~24 h de generarse este export. El fichero <code>datos.json</code> contiene los mismos datos en formato estructurado (portabilidad).</div>
${doc.usuario ? `<h2>Tus datos</h2>${renderValue(doc.usuario)}` : ''}
${
  doc.hijos && doc.hijos.length
    ? doc.hijos.map((h, i) => `<h2>Datos de tu hijo/a ${i + 1}</h2>${renderValue(h)}`).join('')
    : ''
}
${doc.nino ? `<h2>Datos del menor</h2>${renderValue(doc.nino)}` : ''}
</body>
</html>`
}
