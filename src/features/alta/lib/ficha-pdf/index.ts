import type { CopiaFichaFirmada } from './tipos'
import { componerFichaFirmadaV1 } from './v1'

/**
 * Las plantillas del PDF de la ficha firmada, por versión (fase 10c). Cada firma guarda la suya
 * (`plantilla_pdf_version`) y se compone con ESA, nunca con la última: así el PDF que se descarga
 * dentro de un año es el que se firmó. Una versión nueva se AÑADE aquí; ninguna se quita ni se
 * cambia. La que pone la base al firmar (`privado.ficha_plantilla_pdf_version`) tiene que estar aquí:
 * lo comprueba `__tests__/plantillas.test.ts`.
 */
export const PLANTILLAS_FICHA_PDF: Readonly<
  Record<number, (c: CopiaFichaFirmada) => Promise<Uint8Array>>
> = {
  1: componerFichaFirmadaV1,
}

export class PlantillaDesconocida extends Error {}

/** El PDF de una copia firmada, con la plantilla de su firma. */
export async function componerFichaFirmada(c: CopiaFichaFirmada): Promise<Uint8Array> {
  const plantilla = PLANTILLAS_FICHA_PDF[c.plantillaPdfVersion]
  if (!plantilla)
    throw new PlantillaDesconocida(`plantilla del PDF desconocida: ${c.plantillaPdfVersion}`)
  return plantilla(c)
}
