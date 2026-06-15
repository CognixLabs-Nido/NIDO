import 'server-only'

import type { DocumentoExport } from '../types'

/** Traductor del namespace `export` (lo pasa la route con el locale del usuario). */
export type Etiquetador = (key: string) => string

// ---------------------------------------------------------------------------
// Campos con etiqueta legible definida en messages (export.doc.campos.*). El
// resto se humaniza (snake_case → "Texto legible"). Mantener en sync con
// el script de i18n.
// ---------------------------------------------------------------------------
const CAMPOS_CONOCIDOS = new Set<string>([
  'nombre_completo',
  'idioma_preferido',
  'nombre',
  'apellidos',
  'fecha_nacimiento',
  'sexo',
  'nacionalidad',
  'idioma_principal',
  'notas_admin',
  'alergias_graves',
  'notas_emergencia',
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
  'telefono_emergencia',
  'lactancia_estado',
  'lactancia_observaciones',
  'control_esfinteres',
  'control_esfinteres_observaciones',
  'siesta_horario_habitual',
  'siesta_numero_diario',
  'siesta_observaciones',
  'tipo_alimentacion',
  'alimentacion_observaciones',
  'idiomas_casa',
  'tiene_hermanos_en_centro',
  'tipo',
  'aceptado_en',
  'revocado_en',
  'contenido',
  'fecha',
  'tipo_vinculo',
  'parentesco',
  'descripcion_parentesco',
  'permisos',
  'observaciones_generales',
  'observaciones',
  'estado',
  'hora_llegada',
  'hora_salida',
  'fecha_inicio',
  'fecha_fin',
  'motivo',
  'descripcion',
  'periodo',
  'respuestas',
  'publicado_at',
  'titulo',
  'texto',
  'vigencia_desde',
  'vigencia_hasta',
  'decision',
  'nombre_tecleado',
  'comentario',
  'firmado_at',
  'datos',
  'medicamento',
  'dosis',
  'notas',
  'administrado_en',
  'confirmado_at',
  'comidas',
  'biberones',
  'suenos',
  'deposiciones',
  'aparece_junto_a_otros',
  'publicacion_texto',
  'puede_ver_info_medica',
  'puede_recibir_mensajes',
  'puede_ver_fotos',
  'puede_ver_agenda',
  'puede_ver_datos_pedagogicos',
  'puede_reportar_ausencias',
])

// Campos técnicos/internos que se OCULTAN del documento legible.
const TECNICOS = new Set<string>([
  'id',
  'centro_id',
  'texto_hash',
  'texto_version',
  'estructura_snapshot',
  'es_plantilla',
  'ambito',
  'plantilla_id',
  'notificado_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'hash',
  'bucket',
  'path',
  'caduca_en',
  'ip_address',
  'user_agent',
  'version',
  'foto_url',
  'consentimiento_terminos_version',
  'consentimiento_privacidad_version',
  '_aportado_por_ti',
  'autorizacion_id',
  'firmante_id',
])

function esTecnico(k: string): boolean {
  return TECNICOS.has(k) || k.endsWith('_id') || k.startsWith('archivada')
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** snake_case / camelCase → "Texto legible" (fallback de etiqueta y de enum). */
function humanizar(s: string): string {
  const limpio = s.replace(/_/g, ' ').trim()
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

function etiqueta(k: string, t: Etiquetador): string {
  return CAMPOS_CONOCIDOS.has(k) ? t(`doc.campos.${k}`) : humanizar(k)
}

/** YYYY-MM-DD[...] → DD/MM/AAAA (sin horas). HH:MM[:SS] → HH:MM. */
function formatearTexto(v: string): string {
  const fecha = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (fecha) return `${fecha[3]}/${fecha[2]}/${fecha[1]}`
  const hora = v.match(/^(\d{2}):(\d{2})/)
  if (hora) return `${hora[1]}:${hora[2]}`
  // Enum/valor en snake_case o palabra suelta → humanizar; texto libre se respeta.
  if (/^[a-z][a-z0-9_]{0,39}$/.test(v)) return humanizar(v)
  return escape(v)
}

/** Firma dibujada → <img> pequeña; si no se puede, texto "Firmado". */
function renderFirma(v: unknown, t: Etiquetador): string {
  if (typeof v !== 'string' || v.length === 0) return escape(t('doc.firmado'))
  let src: string | null = null
  if (v.startsWith('<svg')) src = `data:image/svg+xml;utf8,${encodeURIComponent(v)}`
  else if (v.startsWith('data:')) src = v
  else if (/^[A-Za-z0-9+/=\s]{100,}$/.test(v)) src = `data:image/png;base64,${v.replace(/\s/g, '')}`
  if (!src) return escape(t('doc.firmado'))
  return `<img class="firma" src="${escape(src)}" alt="${escape(t('doc.campos.firma_imagen'))}" />`
}

function esVacio(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

function formatearValor(k: string, v: unknown, t: Etiquetador): string {
  if (k === 'firma_imagen') return renderFirma(v, t)
  if (k === 'url_firmada') {
    return typeof v === 'string' && v
      ? `<a href="${escape(v)}">${escape(t('doc.descargar'))}</a>`
      : `<span class="nil">${escape(t('doc.sin_datos'))}</span>`
  }
  if (esVacio(v)) return `<span class="nil">—</span>`
  if (typeof v === 'boolean') return escape(v ? t('doc.si') : t('doc.no'))
  if (k === 'sexo' && (v === 'F' || v === 'M' || v === 'X')) return escape(t(`doc.sexo.${v}`))
  if (Array.isArray(v)) return renderLista(v, t)
  if (typeof v === 'object') return renderObjeto(v as Record<string, unknown>, t)
  if (typeof v === 'string') return formatearTexto(v)
  return escape(String(v))
}

function renderLista(arr: unknown[], t: Etiquetador): string {
  if (arr.length === 0) return `<span class="nil">${escape(t('doc.sin_datos'))}</span>`
  // Lista de objetos → tarjetas; lista de escalares → comas.
  if (arr.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    return arr
      .map((x) => `<div class="item">${renderObjeto(x as Record<string, unknown>, t)}</div>`)
      .join('')
  }
  return arr.map((x) => formatearValor('', x, t)).join(', ')
}

function renderObjeto(obj: Record<string, unknown>, t: Etiquetador): string {
  const notas: string[] = []
  const filas: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_nota') {
      if (typeof v === 'string') notas.push(`<p class="nota">${escape(v)}</p>`)
      continue
    }
    if (esTecnico(k)) continue
    filas.push(`<dt>${escape(etiqueta(k, t))}</dt><dd>${formatearValor(k, v, t)}</dd>`)
  }
  const dl = filas.length ? `<dl>${filas.join('')}</dl>` : ''
  return notas.join('') + dl
}

/** Sección con título + lista de filas (o "Sin datos"). */
function seccion(tituloKey: string, items: unknown, t: Etiquetador): string {
  const arr = Array.isArray(items) ? items : []
  const cuerpo = arr.length
    ? renderLista(arr, t)
    : `<p class="nil">${escape(t('doc.sin_datos'))}</p>`
  return `<h3>${escape(t(`doc.secciones.${tituloKey}`))}</h3>${cuerpo}`
}

/** Objeto único (ficha, info médica) bajo un título. */
function seccionObjeto(tituloKey: string, obj: unknown, t: Etiquetador): string {
  const cuerpo =
    obj && typeof obj === 'object'
      ? renderObjeto(obj as Record<string, unknown>, t)
      : `<p class="nil">${escape(t('doc.sin_datos'))}</p>`
  return `<h3>${escape(t(`doc.secciones.${tituloKey}`))}</h3>${cuerpo}`
}

function renderUsuario(u: Record<string, unknown>, t: Etiquetador): string {
  return `<section>
  <h2>${escape(t('doc.secciones.tus_datos'))}</h2>
  ${renderObjeto((u.ficha as Record<string, unknown>) ?? {}, t)}
  ${seccion('consentimientos', u.consentimientos, t)}
  ${seccion('mensajes', u.mensajes, t)}
  ${seccion('ausencias_reportadas', u.ausencias_reportadas, t)}
  ${seccion('invitaciones_citas', u.invitaciones_a_citas, t)}
  ${seccion('recordatorios', u.recordatorios_recibidos, t)}
  ${seccion('firmas_realizadas', u.firmas_realizadas, t)}
</section>`
}

function renderFotos(n: Record<string, unknown>, t: Etiquetador): string {
  const adjuntos = Array.isArray(n.adjuntos) ? (n.adjuntos as Record<string, unknown>[]) : []
  const compartidas = Array.isArray(n.fotos_compartidas)
    ? (n.fotos_compartidas as Record<string, unknown>[])
    : []
  if (adjuntos.length === 0 && compartidas.length === 0) {
    return `<h3>${escape(t('doc.secciones.fotos'))}</h3><p class="nil">${escape(t('doc.sin_datos'))}</p>`
  }
  const enlaces = adjuntos
    .map((a) => {
      const desc = typeof a.descripcion === 'string' ? a.descripcion : t('doc.descargar')
      return `<li>${escape(desc)} — ${formatearValor('url_firmada', a.url_firmada, t)}</li>`
    })
    .join('')
  const otras = compartidas.length ? renderLista(compartidas, t) : ''
  return `<h3>${escape(t('doc.secciones.fotos'))}</h3>${enlaces ? `<ul>${enlaces}</ul>` : ''}${otras}`
}

function renderNino(n: Record<string, unknown>, t: Etiquetador): string {
  const ficha = (n.ficha as Record<string, unknown>) ?? {}
  const nombre =
    [ficha.nombre, ficha.apellidos].filter(Boolean).join(' ') || t('doc.secciones.datos_nino')
  const autorizaciones = seccion('autorizaciones_firmas', n.autorizaciones, t)
  const firmas = Array.isArray(n.firmas) && n.firmas.length ? renderLista(n.firmas, t) : ''
  return `<section>
  <h2>${escape(nombre)}</h2>
  ${seccionObjeto('datos_nino', n.ficha, t)}
  ${seccionObjeto('salud', n.info_medica_emergencia, t)}
  ${seccion('pedagogico', n.datos_pedagogicos, t)}
  ${seccion('vinculos', n.vinculos_familiares, t)}
  ${seccion('agenda', n.agendas_diarias, t)}
  ${seccion('asistencias', n.asistencias, t)}
  ${seccion('ausencias', n.ausencias, t)}
  ${seccion('informes', n.informes_evolucion, t)}
  ${autorizaciones}${firmas}
  ${seccion('medicacion', n.administraciones_medicacion, t)}
  ${renderFotos(n, t)}
</section>`
}

/**
 * Copia HTML legible del export (#1). Documento por secciones con etiquetas en
 * lenguaje natural (i18n), ocultando identificadores/hashes/versiones internas y
 * formateando fechas y firmas. El mismo contenido en crudo está en datos.json.
 */
export function renderExportHtml(doc: DocumentoExport, t: Etiquetador): string {
  const generado =
    typeof doc._meta?.generado_en === 'string' ? formatearTexto(doc._meta.generado_en) : ''
  const cuerpo: string[] = []
  if (doc.usuario) cuerpo.push(renderUsuario(doc.usuario, t))
  if (Array.isArray(doc.hijos)) for (const h of doc.hijos) cuerpo.push(renderNino(h, t))
  if (doc.nino) cuerpo.push(renderNino(doc.nino, t))

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(t('doc.titulo'))}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.6rem; }
  h2 { margin-top: 2.5rem; border-bottom: 2px solid #d9e2ec; padding-bottom: .3rem; }
  h3 { margin-top: 1.6rem; color: #334e68; font-size: 1.05rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: .3rem 0 .3rem 0; }
  dt { font-weight: 600; color: #486581; }
  dd { margin: 0; }
  .item { border: 1px solid #e2e8f0; border-radius: .5rem; padding: .6rem .8rem; margin: .4rem 0; }
  .nil { color: #9aa5b1; }
  .nota { color: #627d98; font-style: italic; margin: .3rem 0; }
  .firma { max-height: 60px; max-width: 240px; border: 1px solid #e2e8f0; border-radius: .3rem; background: #fff; }
  .meta { background: #f0f4f8; padding: 1rem; border-radius: .5rem; }
  .aviso { background: #fffbea; padding: .75rem 1rem; border-radius: .5rem; margin: 1rem 0; font-size: .9rem; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>${escape(t('doc.titulo'))}</h1>
<div class="meta">${escape(t('doc.generado'))} ${escape(generado)}</div>
<div class="aviso">${escape(t('doc.aviso'))}</div>
${cuerpo.join('\n')}
</body>
</html>`
}
