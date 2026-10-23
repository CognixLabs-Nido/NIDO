import 'server-only'

import { formatEuros } from '@/shared/lib/format-money'
import { IDIOMA_CENTINELA_PURGA, idiomasVisibles } from '@/shared/lib/idioma-centinela'

import type { DocumentoExport } from '../types'

/** Traductor del namespace `export` (lo pasa la route con el locale del usuario). */
export type Etiquetador = (key: string) => string

/** Lo que necesita el render: el traductor y el idioma (importes con `formatEuros`). */
interface Ctx {
  t: Etiquetador
  locale: string
}

// ---------------------------------------------------------------------------
// Campos con etiqueta legible definida en messages (export.doc.campos.*). El
// resto se humaniza (snake_case → "Texto legible"). Mantener en sync con
// el script de i18n.
// ---------------------------------------------------------------------------
export const CAMPOS_CONOCIDOS = new Set<string>([
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
  // export completo (art. 15, 20261014120000)
  'clave',
  'valor',
  'actualizado_en',
  'navegador',
  'registrado_en',
  'ultima_actividad',
  'leido_hasta',
  'anuncio',
  'leido_en',
  'email',
  'rol_objetivo',
  'enviada_en',
  'expira_en',
  'aceptada_en',
  'rechazada_en',
  'telefono_tutor',
  'email_tutor',
  'exportado_en',
  'solicitado_por_ti',
  'solicitado_en',
  'gracia_hasta',
  'inmediato',
  'purgado_en',
  'rol_familia',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  'identificador_mandato',
  'titular',
  'iban_ultimos4',
  'metodo_firma',
  'fecha_firma',
  'ip_firma',
  'navegador_firma',
  'familia',
  'recibos',
  'lineas',
  'metodos_pago',
  'conceptos_asignados',
  'beca_comedor_excesos',
  'beca_comedor_transferencias',
  'anio',
  'mes',
  'metodo',
  'total_centimos',
  'es_esporadico',
  'concepto_esporadico',
  'fecha_envio_banco',
  'fecha_devolucion',
  'cobro_forma',
  'cobro_fecha',
  'cobro_nota',
  'cobro_importe_centimos',
  'devolucion_gastos_centimos',
  'devolucion_salida',
  'cantidad',
  'precio_unitario_centimos',
  'importe_centimos',
  'concepto',
  'importe_especial_centimos',
  'cuota_total_centimos',
  'beca_total_centimos',
  'exceso_centimos',
  'via',
  'resuelto_en',
  'realizada_en',
  'nombre_nino',
  'apellidos_nino',
  'nota',
  'posicion',
  'curso',
  'apuntado_en',
  'aula',
  'fecha_alta',
  'fecha_baja',
  'activada_en',
  'motivo_baja',
  'version_texto',
  'otorgado_por',
  'entidad',
  'campo',
  'valor_propuesto',
  'detalle',
  'decidido_en',
  'hora_inicio',
  'hora_fin',
  'lugar',
  'evento',
  'fecha_evento',
  'vencimiento',
  'completado_en',
  'tipo_beca',
  'fecha_desde',
  'fecha_hasta',
  'servicio',
  'presente',
  'activa',
  'anio_correspondiente',
  'mes_correspondiente',
  'anio_aplicacion',
  'mes_aplicacion',
  'origen',
])

// Valores de enum con etiqueta legible (con acentos) en messages
// (export.doc.valores.*). Diccionario plano por VALOR crudo (los valores son
// únicos entre sí). Lo no listado se humaniza (snake_case → "Texto legible").
export const VALORES_CONOCIDOS = new Set<string>([
  // consentimiento_tipo
  'terminos',
  'privacidad',
  'imagen',
  'datos_medicos',
  // tipo_autorizacion
  'salida',
  'medicacion',
  'recogida',
  'reglas_regimen_interno',
  'autorizacion_imagenes',
  // firma_decision
  'firmado',
  'rechazado',
  'revocado',
  // idioma
  'es',
  'en',
  'va',
  // tipo_vinculo
  'tutor_legal_principal',
  'tutor_legal_secundario',
  'autorizado',
  // parentesco
  'madre',
  'padre',
  'abuela',
  'abuelo',
  'tia',
  'tio',
  'hermana',
  'hermano',
  'cuidadora',
  'otro',
  'otra',
  // lactancia_estado
  'materna',
  'biberon',
  'mixta',
  'finalizada',
  'no_aplica',
  // control_esfinteres
  'panal_completo',
  'transicion',
  'sin_panal_diurno',
  'sin_panal_total',
  // tipo_alimentacion
  'omnivora',
  'vegetariana',
  'vegana',
  'sin_lactosa',
  'sin_gluten',
  'religiosa_halal',
  'religiosa_kosher',
  // motivo_ausencia
  'enfermedad',
  'cita_medica',
  'vacaciones',
  'familiar',
  // estado_asistencia
  'presente',
  'ausente',
  'llegada_tarde',
  'salida_temprana',
  // tipo_deposicion / consistencia
  'pipi',
  'caca',
  'mixto',
  'normal',
  'dura',
  'blanda',
  'diarrea',
  // momento_comida
  'desayuno',
  'media_manana',
  'comida',
  'merienda',
  // cantidad_comida
  'todo',
  'mayoria',
  'mitad',
  'poco',
  'nada',
  // tipo_biberon
  'formula',
  'agua',
  'infusion',
  'zumo',
  // periodo_informe
  'trimestre_1',
  'trimestre_2',
  'trimestre_3',
  'fin_curso',
  // valoracion_item_informe / estado genérico
  'conseguido',
  'en_proceso',
  'no_iniciado',
  'pendiente',
  'completado',
  'aceptado',
  'programada',
  'cancelada',
  // export completo (art. 15, 20261014120000)
  'comedor',
  'matinera',
  'vespertina',
  'borrador',
  'pendiente_procesar',
  'enviado_banco',
  'devuelto',
  'cobrado_manual',
  'sepa',
  'efectivo',
  'transferencia',
  'cheque_guarderia',
  'banco',
  'activo',
  'resuelto',
  'reducir',
  'resto',
  'aplicada',
  'anulada',
  'realizada',
  'en_espera',
  'invitado',
  'descartado',
  'activa',
  'baja',
  'lista',
  'reunion_familia',
  'reunion_clase',
  'reunion_claustro',
  'visita',
  'excursion',
  'reunion',
  'fiesta',
  'programado',
  'cancelado',
  'confirmado',
  'aprobado',
  'checkbox',
  'digital',
  'presencial',
  'admin',
  'profe',
  'tutor_legal',
  'titular',
  'segundo_tutor',
  'automatico',
  'manual',
  'normas',
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
  // rutas de Storage: el documento sale como enlace firmado en «Documentos»
  'dni_documento_path',
  'documento_path',
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

function etiqueta(k: string, c: Ctx): string {
  return CAMPOS_CONOCIDOS.has(k) ? c.t(`doc.campos.${k}`) : humanizar(k)
}

/** YYYY-MM-DD[...] → DD/MM/AAAA (sin horas). HH:MM[:SS] → HH:MM. */
function formatearTexto(v: string, c: Ctx): string {
  const fecha = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (fecha) return `${fecha[3]}/${fecha[2]}/${fecha[1]}`
  const hora = v.match(/^(\d{2}):(\d{2})/)
  if (hora) return `${hora[1]}:${hora[2]}`
  // Enum/valor en snake_case o palabra suelta → etiqueta i18n si la conocemos
  // (con acentos), si no humanizar; el texto libre se respeta.
  if (/^[a-z][a-z0-9_]{0,39}$/.test(v)) {
    return VALORES_CONOCIDOS.has(v) ? escape(c.t(`doc.valores.${v}`)) : humanizar(v)
  }
  return escape(v)
}

/** Firma dibujada → <img> pequeña; si no se puede, texto "Firmado". */
function renderFirma(v: unknown, c: Ctx): string {
  if (typeof v !== 'string' || v.length === 0) return escape(c.t('doc.firmado'))
  let src: string | null = null
  if (v.startsWith('<svg')) src = `data:image/svg+xml;utf8,${encodeURIComponent(v)}`
  else if (v.startsWith('data:')) src = v
  else if (/^[A-Za-z0-9+/=\s]{100,}$/.test(v)) src = `data:image/png;base64,${v.replace(/\s/g, '')}`
  if (!src) return escape(c.t('doc.firmado'))
  return `<img class="firma" src="${escape(src)}" alt="${escape(c.t('doc.campos.firma_imagen'))}" />`
}

function esVacio(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

function formatearValor(k: string, v: unknown, c: Ctx): string {
  if (k === 'firma_imagen') return renderFirma(v, c)
  if (k === 'url_firmada') {
    return typeof v === 'string' && v
      ? `<a href="${escape(v)}">${escape(c.t('doc.descargar'))}</a>`
      : `<span class="nil">${escape(c.t('doc.sin_datos'))}</span>`
  }
  if (esVacio(v)) return `<span class="nil">—</span>`
  if (typeof v === 'boolean') return escape(v ? c.t('doc.si') : c.t('doc.no'))
  if (k === 'sexo' && (v === 'F' || v === 'M' || v === 'X')) return escape(c.t(`doc.sexo.${v}`))
  // El dinero viaja en céntimos enteros (`*_centimos`).
  if (k.endsWith('_centimos') && typeof v === 'number') return escape(formatEuros(v, c.locale))
  if (Array.isArray(v)) return renderLista(v, c)
  if (typeof v === 'object') return renderObjeto(v as Record<string, unknown>, c)
  if (typeof v === 'string') return formatearTexto(v, c)
  return escape(String(v))
}

function renderLista(arr: unknown[], c: Ctx): string {
  if (arr.length === 0) return `<span class="nil">${escape(c.t('doc.sin_datos'))}</span>`
  // Lista de objetos → tarjetas; lista de escalares → comas.
  if (arr.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    return arr
      .map((x) => `<div class="item">${renderObjeto(x as Record<string, unknown>, c)}</div>`)
      .join('')
  }
  return arr.map((x) => formatearValor('', x, c)).join(', ')
}

function renderObjeto(obj: Record<string, unknown>, c: Ctx): string {
  const notas: string[] = []
  const filas: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_nota') {
      if (typeof v === 'string') notas.push(`<p class="nota">${escape(v)}</p>`)
      continue
    }
    if (esTecnico(k)) continue
    // El centinela de la purga ('zz') no es un idioma: se trata como vacío.
    const valor =
      k === 'idioma_principal' && v === IDIOMA_CENTINELA_PURGA
        ? null
        : k === 'idiomas_casa' && Array.isArray(v)
          ? idiomasVisibles(v as string[])
          : v
    // Campo sin valor → se OMITE (no se pinta "—"). La firma se conserva: se
    // renderiza como imagen o como texto "Firmado", nunca vacía.
    if (k !== 'firma_imagen' && (esVacio(valor) || (Array.isArray(valor) && valor.length === 0)))
      continue
    filas.push(`<dt>${escape(etiqueta(k, c))}</dt><dd>${formatearValor(k, valor, c)}</dd>`)
  }
  const dl = filas.length ? `<dl>${filas.join('')}</dl>` : ''
  return notas.join('') + dl
}

/** Sección con título + lista de filas (o "Sin datos"). */
function seccion(tituloKey: string, items: unknown, c: Ctx): string {
  const arr = Array.isArray(items) ? items : []
  const cuerpo = arr.length
    ? renderLista(arr, c)
    : `<p class="nil">${escape(c.t('doc.sin_datos'))}</p>`
  return `<h3>${escape(c.t(`doc.secciones.${tituloKey}`))}</h3>${cuerpo}`
}

/** Objeto único (ficha, info médica) bajo un título. */
function seccionObjeto(tituloKey: string, obj: unknown, c: Ctx): string {
  const cuerpo =
    obj && typeof obj === 'object'
      ? renderObjeto(obj as Record<string, unknown>, c)
      : `<p class="nil">${escape(c.t('doc.sin_datos'))}</p>`
  return `<h3>${escape(c.t(`doc.secciones.${tituloKey}`))}</h3>${cuerpo}`
}

/** Nota de «sin acceso a los datos ampliados» (la profe que exporta, p. ej.). */
function seccionDatosAmpliados(v: unknown, c: Ctx): string {
  return v && typeof v === 'object' ? seccionObjeto('datos_ampliados', v, c) : ''
}

/** Documentos (DNI, mandato firmado) como enlaces firmados (#4). */
function seccionDocumentos(items: unknown, c: Ctx): string {
  const arr = Array.isArray(items) ? (items as Record<string, unknown>[]) : []
  if (arr.length === 0) return ''
  const enlaces = arr
    .map((a) => {
      const desc = typeof a.descripcion === 'string' ? a.descripcion : c.t('doc.descargar')
      return `<li>${escape(desc)} — ${formatearValor('url_firmada', a.url_firmada, c)}</li>`
    })
    .join('')
  return `<h3>${escape(c.t('doc.secciones.documentos'))}</h3><ul>${enlaces}</ul>`
}

function renderUsuario(u: Record<string, unknown>, c: Ctx): string {
  return `<section>
  <h2>${escape(c.t('doc.secciones.tus_datos'))}</h2>
  ${renderObjeto((u.ficha as Record<string, unknown>) ?? {}, c)}
  ${seccion('perfil_familia', u.perfiles_familia, c)}
  ${seccion('consentimientos', u.consentimientos, c)}
  ${seccion('ausencias_reportadas', u.ausencias_reportadas, c)}
  ${seccion('invitaciones_citas', u.invitaciones_a_citas, c)}
  ${seccion('recordatorios', u.recordatorios_recibidos, c)}
  ${seccion('firmas_realizadas', u.firmas_realizadas, c)}
  ${seccion('mandatos_sepa', u.mandatos_sepa, c)}
  ${seccion('cobros_familia', u.cobros_familia, c)}
  ${seccion('lista_espera_contacto', u.lista_espera_contacto, c)}
  ${seccion('invitaciones_cuenta', u.invitaciones, c)}
  ${seccion('preferencias', u.preferencias, c)}
  ${seccion('dispositivos', u.dispositivos, c)}
  ${seccion('lecturas_conversaciones', u.lecturas_conversaciones, c)}
  ${seccion('lecturas_anuncios', u.lecturas_anuncios, c)}
  ${seccion('exportaciones', u.exportaciones, c)}
  ${seccion('solicitudes_olvido', u.solicitudes_olvido, c)}
  ${seccionDocumentos(u.adjuntos, c)}
  ${seccionDatosAmpliados(u.datos_ampliados, c)}
</section>`
}

function renderFotos(n: Record<string, unknown>, c: Ctx): string {
  const adjuntos = Array.isArray(n.adjuntos) ? (n.adjuntos as Record<string, unknown>[]) : []
  const compartidas = Array.isArray(n.fotos_compartidas)
    ? (n.fotos_compartidas as Record<string, unknown>[])
    : []
  if (adjuntos.length === 0 && compartidas.length === 0) {
    return `<h3>${escape(c.t('doc.secciones.fotos'))}</h3><p class="nil">${escape(c.t('doc.sin_datos'))}</p>`
  }
  const enlaces = adjuntos
    .map((a) => {
      const desc = typeof a.descripcion === 'string' ? a.descripcion : c.t('doc.descargar')
      return `<li>${escape(desc)} — ${formatearValor('url_firmada', a.url_firmada, c)}</li>`
    })
    .join('')
  const otras = compartidas.length ? renderLista(compartidas, c) : ''
  return `<h3>${escape(c.t('doc.secciones.fotos'))}</h3>${enlaces ? `<ul>${enlaces}</ul>` : ''}${otras}`
}

/**
 * Valoraciones de un informe: cruza la estructura congelada (áreas → ítems con
 * `texto`) con las respuestas (`{ item_id: { valoracion, comentario } }`). Por
 * cada ítem muestra el TEXTO de la pregunta (no "Item N") junto a su valoración.
 */
function renderValoracionesInforme(estructura: unknown, respuestas: unknown, c: Ctx): string {
  const areas = Array.isArray(estructura) ? estructura : []
  const resp =
    respuestas && typeof respuestas === 'object' ? (respuestas as Record<string, unknown>) : {}
  const bloques: string[] = []
  for (const area of areas) {
    if (!area || typeof area !== 'object') continue
    const a = area as Record<string, unknown>
    const items = Array.isArray(a.items) ? a.items : []
    const filas: string[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      const id = typeof it.id === 'string' ? it.id : ''
      const pregunta =
        (typeof it.texto === 'string' && it.texto) ||
        (typeof it.titulo === 'string' && it.titulo) ||
        ''
      const r =
        id && resp[id] && typeof resp[id] === 'object'
          ? (resp[id] as Record<string, unknown>)
          : null
      if (!r) continue // ítem sin respuesta → no se muestra
      const comentario = typeof r.comentario === 'string' ? r.comentario : ''
      filas.push(
        `<div class="item"><p class="pregunta">${escape(pregunta)}</p><dl>` +
          `<dt>${escape(c.t('doc.campos.valoracion'))}</dt><dd>${formatearValor('', r.valoracion, c)}</dd>` +
          (comentario
            ? `<dt>${escape(c.t('doc.campos.comentario'))}</dt><dd>${formatearTexto(comentario, c)}</dd>`
            : '') +
          `</dl></div>`
      )
    }
    if (filas.length === 0) continue
    const titulo = typeof a.titulo === 'string' && a.titulo ? `<h4>${escape(a.titulo)}</h4>` : ''
    bloques.push(titulo + filas.join(''))
  }
  return bloques.length ? bloques.join('') : `<p class="nil">${escape(c.t('doc.sin_datos'))}</p>`
}

/** Un informe: cabecera (período, fecha, observaciones) + sus valoraciones legibles. */
function renderInforme(inf: Record<string, unknown>, c: Ctx): string {
  const { respuestas, estructura_snapshot, ...resto } = inf
  const cabecera = renderObjeto(resto, c)
  const valoraciones = renderValoracionesInforme(estructura_snapshot, respuestas, c)
  return `<div class="item">${cabecera}<h4 class="sub">${escape(c.t('doc.campos.respuestas'))}</h4>${valoraciones}</div>`
}

/** Sección de informes de evolución (cada informe con sus valoraciones legibles). */
function seccionInformes(items: unknown, c: Ctx): string {
  const arr = Array.isArray(items) ? items : []
  const cuerpo = arr.length
    ? arr.map((inf) => renderInforme((inf ?? {}) as Record<string, unknown>, c)).join('')
    : `<p class="nil">${escape(c.t('doc.sin_datos'))}</p>`
  return `<h3>${escape(c.t('doc.secciones.informes'))}</h3>${cuerpo}`
}

function renderNino(n: Record<string, unknown>, c: Ctx): string {
  const ficha = (n.ficha as Record<string, unknown>) ?? {}
  const nombre =
    [ficha.nombre, ficha.apellidos].filter(Boolean).join(' ') || c.t('doc.secciones.datos_nino')
  const autorizaciones = seccion('autorizaciones_firmas', n.autorizaciones, c)
  const firmas = Array.isArray(n.firmas) && n.firmas.length ? renderLista(n.firmas, c) : ''
  return `<section>
  <h2>${escape(nombre)}</h2>
  ${seccionObjeto('datos_nino', n.ficha, c)}
  ${seccionObjeto('salud', n.info_medica_emergencia, c)}
  ${seccion('pedagogico', n.datos_pedagogicos, c)}
  ${seccion('vinculos', n.vinculos_familiares, c)}
  ${seccion('agenda', n.agendas_diarias, c)}
  ${seccion('asistencias', n.asistencias, c)}
  ${seccion('ausencias', n.ausencias, c)}
  ${seccionInformes(n.informes_evolucion, c)}
  ${autorizaciones}${firmas}
  ${seccion('medicacion', n.administraciones_medicacion, c)}
  ${renderFotos(n, c)}
  ${seccion('lista_espera', n.lista_espera, c)}
  ${seccion('matriculas', n.matriculas, c)}
  ${seccion('fin_de_curso', n.fin_de_curso, c)}
  ${seccion('consentimientos_nino', n.consentimientos, c)}
  ${seccion('acuses_alta', n.acuses_alta, c)}
  ${seccion('cambios_solicitados', n.cambios_solicitados, c)}
  ${seccion('citas', n.citas, c)}
  ${seccion('eventos', n.eventos, c)}
  ${seccion('confirmaciones_eventos', n.confirmaciones_eventos, c)}
  ${seccion('recordatorios_nino', n.recordatorios, c)}
  ${seccion('servicios_diarios', n.servicios_diarios, c)}
  ${seccion('lineas_recibo', n.lineas_recibo, c)}
  ${seccion('becas', n.becas, c)}
  ${seccion('conceptos_asignados', n.conceptos_asignados, c)}
  ${seccion('beca_comedor_elegibilidad', n.beca_comedor_elegibilidad, c)}
  ${seccion('beca_comedor_tramos', n.beca_comedor_tramos, c)}
  ${seccionDatosAmpliados(n.datos_ampliados, c)}
</section>`
}

/**
 * Copia HTML legible del export (#1). Documento por secciones con etiquetas en
 * lenguaje natural (i18n), ocultando identificadores/hashes/versiones internas y
 * formateando fechas y firmas. El mismo contenido en crudo está en datos.json.
 */
export function renderExportHtml(doc: DocumentoExport, t: Etiquetador, locale: string): string {
  const c: Ctx = { t, locale }
  const generado =
    typeof doc._meta?.generado_en === 'string' ? formatearTexto(doc._meta.generado_en, c) : ''
  const cuerpo: string[] = []
  if (doc.usuario) cuerpo.push(renderUsuario(doc.usuario, c))
  if (Array.isArray(doc.hijos)) for (const h of doc.hijos) cuerpo.push(renderNino(h, c))
  if (doc.nino) cuerpo.push(renderNino(doc.nino, c))

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(c.t('doc.titulo'))}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.6rem; }
  h2 { margin-top: 2.5rem; border-bottom: 2px solid #d9e2ec; padding-bottom: .3rem; }
  h3 { margin-top: 1.6rem; color: #334e68; font-size: 1.05rem; }
  h4 { margin: 1rem 0 .3rem; color: #486581; font-size: .95rem; }
  h4.sub { margin-top: .8rem; }
  .pregunta { font-weight: 600; margin: 0 0 .2rem; color: #243b53; }
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
<h1>${escape(c.t('doc.titulo'))}</h1>
<div class="meta">${escape(c.t('doc.generado'))} ${escape(generado)}</div>
<div class="aviso">${escape(c.t('doc.aviso'))}</div>
${cuerpo.join('\n')}
</body>
</html>`
}
