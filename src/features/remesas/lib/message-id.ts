// MsgId (y PmtInfId, que lleva el mismo valor) del fichero pain.008 de una remesa.
//
// Sale de la MARCA del fichero (`remesas.fichero_generado_at`), no de la hora de la descarga.
// El banco reconoce un fichero repetido por su MsgId: con la hora de la descarga, cada descarga
// era un fichero distinto, y subir dos veces la misma remesa la cobraba dos veces. Con la marca,
// toda descarga de la misma versión lleva el mismo MsgId y el banco rechaza la segunda.
//
// Una versión = una marca. Al reabrir una remesa se quita la marca y la versión nueva tendrá
// otra (spec `docs/specs/altas-serie.md`, «Reabrir una remesa»). `CreDtTm` sigue siendo la hora
// de la descarga: no es lo que el banco usa para reconocer el fichero.
//
// `NIDO-{8 primeros del id}-{AAAAMMDDhhmmss en UTC}`: 28 caracteres, dentro de Max35.

export function messageIdRemesa(remesaId: string, marca: string): string {
  const d = new Date(marca)
  if (Number.isNaN(d.getTime())) throw new Error('messageIdRemesa: marca del fichero no válida')
  return `NIDO-${remesaId.slice(0, 8)}-${d.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`
}
