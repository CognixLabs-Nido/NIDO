import type { AdjuntoFirma, PersonaAutorizada, PersonaAutorizadaEdit } from '../types'

/**
 * Extrae los adjuntos de DNI del estado del editor (cliente): para las personas
 * válidas (nombre + DNI) que tienen foto subida, ata `metadata.dni` a la persona.
 * El server revalida (RLS de Storage + `adjuntosDelNino`).
 */
export function adjuntosDeEdicion(personas: PersonaAutorizadaEdit[]): AdjuntoFirma[] {
  return personas
    .filter((p) => p.nombre.trim().length > 0 && p.dni.trim().length > 0 && p.dni_adjunto)
    .map((p) => ({
      bucket: p.dni_adjunto!.bucket,
      path: p.dni_adjunto!.path,
      hash: p.dni_adjunto!.hash,
      metadata: { tipo: 'dni_recogida' as const, dni: p.dni.trim() },
    }))
}

/**
 * Construye el `datos` de una firma de **recogida** (= payload del hash compuesto).
 * Compatibilidad F8: **sin adjuntos** el payload es `{ personas }` EXACTO (mismo
 * hash que las recogidas de F8-2b). **Con** fotos de DNI (F10-3): `{ personas,
 * adjuntos }`. La MISMA función la usan los actions que firman y la verificación de
 * integridad del detalle → el hash siempre cuadra.
 */
export function datosRecogida(
  personas: PersonaAutorizada[],
  adjuntos?: AdjuntoFirma[]
): { personas: PersonaAutorizada[]; adjuntos?: AdjuntoFirma[] } {
  return adjuntos && adjuntos.length > 0 ? { personas, adjuntos } : { personas }
}

/**
 * Filtra los adjuntos a los que **cuelgan del niño firmante** (2.º segmento del
 * path = `nino_id`): aislamiento entre familias en el lado server, además de la RLS
 * de `storage.objects`. Evita que un cliente manipulado ate al hash el DNI de otro.
 */
export function adjuntosDelNino(
  adjuntos: AdjuntoFirma[] | undefined,
  ninoId: string
): AdjuntoFirma[] {
  if (!adjuntos) return []
  return adjuntos.filter((a) => a.path.split('/')[1] === ninoId)
}
