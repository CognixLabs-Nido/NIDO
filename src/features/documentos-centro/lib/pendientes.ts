import { frenaElAlta, type DocumentoEnElCierre } from '@/features/alta/lib/regla-documentos-alta'

/**
 * Lo pendiente de los documentos del centro fuera del alta (fase 4, 4c; spec `altas-serie.md`,
 * «Fase 4»). Sin esto, una familia que se matricula hoy no firma nunca y nadie se entera.
 *
 * Dos clases de pendiente, y no se mezclan («no existía» no es «no ha firmado», 2026-11-05):
 *  - **por firmar**: la versión existe y la familia no la ha firmado. Es de la familia, y lleva
 *    desde cuándo pudo firmarla (`disponible_desde`);
 *  - **sin subir** (`falta_documento`): el centro no tiene versión para ese curso. Es del centro.
 *
 * Solo lo obligatorio. Un opcional sale en la lista del niño, pero no en un aviso: una familia que
 * decide no firmarlo lo vería para siempre.
 */

/**
 * ¿La familia debe este documento? Es la regla del cierre del alta (`frenaElAlta`): lo que no deja
 * cerrar un alta es lo mismo que se le reclama a una familia que ya la cerró.
 */
export function laFamiliaLoDebe(d: DocumentoEnElCierre): boolean {
  return frenaElAlta(d)
}

/** Una fila de `documentos_firma_centro` (4a): solo lo no firmado de cada niño del centro. */
export interface FilaPendienteCentro {
  nino_id: string
  documento_id: string
  titulo: string
  obligatorio: boolean
  curso_academico_id: string | null
  curso_nombre: string | null
  estado: string
  disponible_desde: string | null
}

export interface NinoPorFirmar {
  ninoId: string
  nombre: string
  /** Desde cuándo pudo firmarlo. */
  desde: string
}

export interface GrupoPorFirmar {
  documentoId: string
  titulo: string
  cursoNombre: string | null
  /** Del que lleva más tiempo al que menos. */
  ninos: NinoPorFirmar[]
}

export interface GrupoSinSubir {
  documentoId: string
  titulo: string
  cursoNombre: string | null
  /** Cuántos niños lo necesitan. */
  ninos: number
}

export interface PendientesCentro {
  porFirmar: GrupoPorFirmar[]
  sinSubir: GrupoSinSubir[]
}

const clave = (f: FilaPendienteCentro) => `${f.documento_id}:${f.curso_academico_id ?? ''}`

/**
 * Lo pendiente del centro, por documento y curso. Lo por firmar, primero el grupo que lleva más
 * tiempo esperando; lo sin subir, por título.
 */
export function agruparPendientesCentro(
  filas: readonly FilaPendienteCentro[],
  nombres: ReadonlyMap<string, string>
): PendientesCentro {
  const porFirmar = new Map<string, GrupoPorFirmar>()
  const sinSubir = new Map<string, GrupoSinSubir>()
  for (const f of filas) {
    if (laFamiliaLoDebe(f) && f.disponible_desde) {
      const g = porFirmar.get(clave(f)) ?? {
        documentoId: f.documento_id,
        titulo: f.titulo,
        cursoNombre: f.curso_nombre,
        ninos: [],
      }
      g.ninos.push({
        ninoId: f.nino_id,
        nombre: nombres.get(f.nino_id) ?? '—',
        desde: f.disponible_desde,
      })
      porFirmar.set(clave(f), g)
    } else if (f.obligatorio && f.estado === 'falta_documento') {
      const g = sinSubir.get(clave(f)) ?? {
        documentoId: f.documento_id,
        titulo: f.titulo,
        cursoNombre: f.curso_nombre,
        ninos: 0,
      }
      g.ninos += 1
      sinSubir.set(clave(f), g)
    }
  }
  const grupos = [...porFirmar.values()]
  for (const g of grupos) g.ninos.sort((a, b) => a.desde.localeCompare(b.desde))
  grupos.sort((a, b) => a.ninos[0]!.desde.localeCompare(b.ninos[0]!.desde))
  return {
    porFirmar: grupos,
    sinSubir: [...sinSubir.values()].sort(
      (a, b) =>
        a.titulo.localeCompare(b.titulo) || (a.cursoNombre ?? '').localeCompare(b.cursoNombre ?? '')
    ),
  }
}
