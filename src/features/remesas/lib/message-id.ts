// MsgId del fichero pain.008 de una remesa (y el PmtInfId: el mismo valor con un bloque, y
// `{MsgId}-{n}` con varios, uno por fecha de cobro).
//
// Sale de la MARCA del fichero (`remesas.fichero_generado_at`), no de la hora de la descarga.
// El banco reconoce un fichero repetido por su MsgId: con la hora de la descarga, cada descarga
// era un fichero distinto, y subir dos veces la misma remesa la cobraba dos veces. Con la marca,
// toda descarga de la misma versión lleva el mismo MsgId y el banco rechaza la segunda.
//
// Una versión = una marca. Al reabrir una remesa se quita la marca y la versión nueva tendrá
// otra (spec `docs/specs/altas-serie.md`, «Reabrir una remesa»). Desde la F2 de la fecha de cobro
// también `CreDtTm` y la fecha por defecto salen de la marca (`versionRemesa`): antes `CreDtTm` era
// la hora de la descarga, y dos descargas nunca daban el mismo fichero byte a byte.
//
// `NIDO-{8 primeros del id}-{AAAAMMDDhhmmss en UTC}`: 28 caracteres, dentro de Max35.

export function messageIdRemesa(remesaId: string, marca: string): string {
  const d = new Date(marca)
  if (Number.isNaN(d.getTime())) throw new Error('messageIdRemesa: marca del fichero no válida')
  return `NIDO-${remesaId.slice(0, 8)}-${d.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`
}

/** Lo que una versión del fichero saca de su marca, y nada más. */
export interface VersionRemesa {
  /** `MsgId`: el mismo en cada descarga de la versión. */
  messageId: string
  /** `CreDtTm`: la hora de la marca (UTC, sin milisegundos), no la de la descarga. */
  creationDateTime: string
  /**
   * La fecha de cobro de los recibos que no tienen la suya: el día de la marca en Europe/Madrid,
   * el día en que la directora generó la versión. El banco la ajusta si no cumple plazos.
   */
  fechaPorDefecto: string
}

/**
 * Todo lo del fichero que no sale de los recibos sale de la marca: dos descargas de la misma
 * versión, en días distintos y sin cambios en los datos, dan el mismo fichero byte a byte.
 */
export function versionRemesa(remesaId: string, marca: string): VersionRemesa {
  const messageId = messageIdRemesa(remesaId, marca)
  const d = new Date(marca)
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const parte = (t: string) => partes.find((p) => p.type === t)!.value
  return {
    messageId,
    creationDateTime: d.toISOString().slice(0, 19),
    fechaPorDefecto: `${parte('year')}-${parte('month')}-${parte('day')}`,
  }
}
