import type { ContenidoBloqueado, Fila } from '../types'
import { APARTADOS } from '../types'

/**
 * Lo bloqueado de un sujeto en un HTML imprimible, para entregarlo al requirente (Hacienda, un
 * juzgado, la autoridad de protección de datos). Lleva el motivo y la fecha de la consulta, que es
 * la misma que deja su fila en el registro. Todo se escapa; la firma dibujada solo se pinta si es
 * una imagen en base64.
 */
export interface TextosHtml {
  titulo: string
  sujeto: string
  motivo: string
  generado: string
  bloqueadoDesde: string
  sinFilas: string
  apartados: Record<string, string>
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const IMAGEN = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/

/** El valor de un campo, como texto (o la imagen de la firma). Exportada para su test. */
export function valorHtml(clave: string, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (clave === 'firma_imagen' && typeof v === 'string' && IMAGEN.test(v)) {
    return `<img src="${v}" alt="" style="max-width:320px;max-height:120px">`
  }
  if (typeof v === 'object') return `<pre>${escape(JSON.stringify(v, null, 2))}</pre>`
  return escape(String(v))
}

function fila(f: Fila): string {
  const campos = Object.entries(f)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<dt>${escape(k)}</dt><dd>${valorHtml(k, v)}</dd>`)
    .join('')
  return `<dl>${campos}</dl>`
}

export function renderDatosBloqueadosHtml(
  c: ContenidoBloqueado,
  datos: { sujeto: string; motivo: string; generadoEn: string },
  t: TextosHtml
): string {
  const orden = [
    ...APARTADOS,
    ...Object.keys(c.apartados).filter((k) => !APARTADOS.includes(k as never)),
  ]
  const secciones = orden
    .filter((k) => k in c.apartados)
    .map((k) => {
      const filas = c.apartados[k] ?? []
      const cuerpo = filas.length ? filas.map(fila).join('<hr>') : `<p>${escape(t.sinFilas)}</p>`
      return `<h2>${escape(t.apartados[k] ?? k)}</h2>${cuerpo}`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t.titulo)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#222}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;font-size:.9rem}dt{color:#555}
dd{margin:0;word-break:break-word}pre{margin:0;white-space:pre-wrap}h2{margin-top:2rem}</style></head>
<body><h1>${escape(t.titulo)}</h1>
<p>${escape(t.sujeto)}: ${escape(datos.sujeto)}</p>
${c.bloqueadoDesde ? `<p>${escape(t.bloqueadoDesde)}: ${escape(c.bloqueadoDesde)}</p>` : ''}
<p>${escape(t.motivo)}: ${escape(datos.motivo)}</p>
<p>${escape(t.generado)}: ${escape(datos.generadoEn)}</p>
${secciones}</body></html>`
}
