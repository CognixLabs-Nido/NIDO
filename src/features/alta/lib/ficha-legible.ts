import 'server-only'

import { CAMPOS_CONOCIDOS, VALORES_CONOCIDOS } from '@/features/export/lib/render-html'

/**
 * La ficha que se firma, puesta en palabras para enseñarla antes de firmar (10b-2). Lo que se firma
 * es el `jsonb` de la base y su sello; esto es solo cómo se lee. Las etiquetas y los valores son los
 * del export del art. 15 (`export.doc.campos` y `export.doc.valores`), para que la ficha firmada y
 * el export digan lo mismo con las mismas palabras.
 */

export type Traductor = (key: string) => string

export interface FilaLegible {
  etiqueta: string
  valor: string
}

export interface SeccionLegible {
  /** Clave de `alta.firma.secciones.*`. */
  seccion: 'nino' | 'tutor' | 'pedagogicos' | 'servicios' | 'gastos' | 'imagen' | 'medico'
  filas: FilaLegible[]
}

/** Lo que no se enseña: identificadores internos y la versión de la foto. */
const OCULTOS = new Set(['version', 'concepto_id', 'curso_academico_id', 'usuario_id'])

function humanizar(s: string): string {
  const limpio = s.replace(/_/g, ' ').trim()
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

function etiqueta(k: string, t: Traductor): string {
  if (k === 'estado_civil_familia') return t('alta.tutor.estado_civil')
  return CAMPOS_CONOCIDOS.has(k) ? t(`export.doc.campos.${k}`) : humanizar(k)
}

const ESTADO_CIVIL = new Set([
  'casados',
  'separados',
  'divorciados',
  'pareja_de_hecho',
  'soltero',
  'viudo',
])

export function valorLegible(k: string, v: unknown, t: Traductor): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return t(v ? 'export.doc.si' : 'export.doc.no')
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map((x) => valorLegible(k, x, t)).join(', ')
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return JSON.stringify(v)
  if (k === 'sexo' && (v === 'F' || v === 'M' || v === 'X')) return t(`export.doc.sexo.${v}`)
  if (k === 'respuesta' && (v === 'no' || v === 'mensual' || v === 'dias_sueltos'))
    return t(`export.doc.respuesta_servicio.${v}`)
  if (k === 'forma' && (v === 'transferencia' || v === 'efectivo'))
    return t(`export.doc.forma_gastos.${v}`)
  if (k === 'estado_civil_familia' && ESTADO_CIVIL.has(v))
    return t(`alta.tutor.estado_civil_opciones.${v}`)
  const fecha = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (fecha) return `${fecha[3]}/${fecha[2]}/${fecha[1]}`
  if (/^[a-z][a-z0-9_]{0,39}$/.test(v) && VALORES_CONOCIDOS.has(v))
    return t(`export.doc.valores.${v}`)
  return v
}

function filas(obj: unknown, t: Traductor): FilaLegible[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>)
    .filter(([k]) => !OCULTOS.has(k))
    .map(([k, v]) => ({ etiqueta: etiqueta(k, t), valor: valorLegible(k, v, t) }))
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * Las secciones de la ficha, en el orden de lo que se declaró. `nombreDe` pone el nombre del tutor a
 * su respuesta de imagen (la foto la guarda por cuenta, no por nombre); si no se conoce, «—».
 */
export function fichaLegible(
  ficha: Record<string, unknown>,
  t: Traductor,
  nombreDe: (usuarioId: string) => string | null
): SeccionLegible[] {
  const secciones: SeccionLegible[] = [{ seccion: 'nino', filas: filas(ficha.nino, t) }]
  for (const tutor of lista(ficha.tutores))
    secciones.push({ seccion: 'tutor', filas: filas(tutor, t) })
  secciones.push({ seccion: 'pedagogicos', filas: filas(ficha.pedagogicos, t) })
  const servicios = lista(ficha.servicios).flatMap((s) => {
    const r = s as Record<string, unknown>
    return [
      {
        etiqueta: valorLegible('servicio', r.servicio, t),
        valor: valorLegible('respuesta', r.respuesta, t),
      },
    ]
  })
  if (servicios.length > 0) secciones.push({ seccion: 'servicios', filas: servicios })
  const gastos = lista(ficha.gastos_gestion).flatMap((g) => filas(g, t))
  if (gastos.length > 0) secciones.push({ seccion: 'gastos', filas: gastos })
  const imagen = lista(ficha.imagen).map((i) => {
    const r = i as Record<string, unknown>
    const nombre = typeof r.usuario_id === 'string' ? nombreDe(r.usuario_id) : null
    const respuesta = r.respuesta === 'si' ? t('export.doc.si') : t('export.doc.no')
    return {
      etiqueta: nombre ?? '—',
      valor: `${respuesta} (${valorLegible('aceptado_en', r.aceptado_en, t)})`,
    }
  })
  if (imagen.length > 0) secciones.push({ seccion: 'imagen', filas: imagen })
  secciones.push({ seccion: 'medico', filas: filas(ficha.medico, t) })
  return secciones
}
