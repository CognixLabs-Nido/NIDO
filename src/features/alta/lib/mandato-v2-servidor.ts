import 'server-only'

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

import { documentoValido } from './documento-identidad'
import { textoCanonicoMandatoV2 } from './mandato-sepa'

/**
 * Lo común de los tres caminos que crean un mandato (0c-2): el alta
 * (`/alta/[ninoId]/mandato-sepa`), la familia desde Recibos (`/family/domiciliacion`) y el
 * presencial de Dirección (`gestionarDomiciliacionFamilia`). Los tres firman un mandato v2: el
 * texto canónico con el CID del centro y el documento y la dirección del titular, y su hash, que
 * la base guarda con la foto del acreedor (`20261229120000`).
 */

export const MIN_LARGO_DIRECCION = 5
export const MAX_LARGO_DIRECCION = 300

export interface AcreedorMandato {
  nombre: string
  /** El CID del centro, o null si no tiene: sin él no se firma ningún mandato. */
  cid: string | null
}

/** El acreedor (el centro) con la sesión de quien firma: la RLS de `centros` se lo deja leer. */
export async function acreedorDelCentro(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<AcreedorMandato | null> {
  const { data } = await supabase
    .from('centros')
    .select('nombre, identificador_acreedor')
    .eq('id', centroId)
    .maybeSingle()
  if (!data) return null
  const cid = data.identificador_acreedor?.trim() ?? ''
  return { nombre: data.nombre, cid: cid === '' ? null : cid }
}

export function direccionValida(raw: string): boolean {
  const t = raw.trim()
  return t.length >= MIN_LARGO_DIRECCION && t.length <= MAX_LARGO_DIRECCION
}

export interface DatosMandatoV2 {
  identificadorMandato: string
  /** El IBAN en claro del formulario (el hash ancla lo firmado, no lo cifrado). */
  iban: string
  titular: string
  titularDocumento: string
  titularDireccion: string
  acreedor: { nombre: string; cid: string }
  fechaFirmaIso: string
}

/** El hash del texto v2 y los parámetros con los que la base lo guarda como v2. */
export function mandatoV2(d: DatosMandatoV2) {
  const titularDocumento = d.titularDocumento.trim()
  const titularDireccion = d.titularDireccion.trim()
  const textoHash = createHash('sha256')
    .update(
      textoCanonicoMandatoV2({
        identificadorMandato: d.identificadorMandato,
        iban: d.iban,
        titular: d.titular.trim(),
        titularDocumento,
        titularDireccion,
        acreedorNombre: d.acreedor.nombre,
        acreedorCid: d.acreedor.cid,
        fechaFirmaIso: d.fechaFirmaIso,
      })
    )
    .digest('hex')
  return {
    textoHash,
    rpc: {
      p_titular_documento: titularDocumento,
      p_titular_direccion: titularDireccion,
      // Lo mismo que entra en el hash: la base comprueba que son los del centro.
      p_acreedor_cid: d.acreedor.cid,
      p_acreedor_nombre: d.acreedor.nombre,
    },
  }
}

/** Valida el documento y la dirección del titular; devuelve el sufijo de la clave de error. */
export function errorDatosTitular(documento: unknown, direccion: unknown): string | null {
  if (typeof documento !== 'string' || !documentoValido(documento)) return 'documento'
  if (typeof direccion !== 'string' || !direccionValida(direccion)) return 'direccion'
  return null
}

/**
 * Lo que contesta la base al firmar un v2 (`privado.version_datos_mandato`), por su HINT. Sin
 * CID, o un acreedor que cambió entre leerlo y firmar (`cid_distinto`, `acreedor_distinto`): lo
 * dice. Un v2 incompleto o sin hash no lo produce la app: es un fallo al guardar.
 */
export function motivoRechazoV2(
  hint: string | null | undefined
): 'centro_sin_cid' | 'acreedor_cambio' | null {
  if (hint === 'centro_sin_cid') return 'centro_sin_cid'
  if (hint === 'cid_distinto' || hint === 'acreedor_distinto') return 'acreedor_cambio'
  return null
}
