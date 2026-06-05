import type {
  EstadoFirmaNino,
  FirmaDecision,
  FirmanteRequerido,
  PoliticaFirmantes,
  TipoVinculo,
} from '../types'

/** Un vínculo del niño que puede firmar (tutor/autorizado), con su rol. */
export interface FirmanteVinculo {
  firmante_id: string
  firmante_nombre: string
  rol_firmante: TipoVinculo
  /** Tutor legal principal: la base del set requerido en políticas "principal". */
  es_principal: boolean
}

/** Una firma con la info mínima para resolver la vigente por firmante. */
export interface FirmaEfectiva {
  firmante_id: string
  decision: FirmaDecision
  /** ISO timestamp; la más reciente por firmante es la vigente (append-only, D4). */
  firmado_at: string
}

/**
 * Reduce el histórico append-only de firmas a la **vigente por firmante**: la
 * fila más reciente por `firmado_at`. Revocar/re-firmar añade filas; la última
 * gana (modelo D4). Empates por timestamp: gana la que aparece después (orden
 * estable de entrada), irrelevante en la práctica (resolución de microsegundos).
 */
export function firmasVigentesPorFirmante(firmas: FirmaEfectiva[]): Map<string, FirmaEfectiva> {
  const vigentes = new Map<string, FirmaEfectiva>()
  for (const f of firmas) {
    const prev = vigentes.get(f.firmante_id)
    if (!prev || f.firmado_at >= prev.firmado_at) {
      vigentes.set(f.firmante_id, f)
    }
  }
  return vigentes
}

/** El set de firmantes requeridos según la política. */
function firmantesRequeridos(
  politica: PoliticaFirmantes,
  vinculos: FirmanteVinculo[]
): FirmanteVinculo[] {
  if (politica === 'cualquiera') return vinculos
  // uno_principal / todos_los_principales → solo los principales. Si no hay
  // principales (dato incompleto), caemos a todos los vínculos para no dejar la
  // autorización sin firmantes posibles.
  const principales = vinculos.filter((v) => v.es_principal)
  return principales.length > 0 ? principales : vinculos
}

/**
 * Calcula el **estado de firma agregado de un niño** dentro de una autorización,
 * a partir de la política `firmantes_requeridos`, sus vínculos firmantes y las
 * firmas vigentes (última por firmante). Lógica pura y determinista — el corazón
 * testeable de F8-1; las queries solo aportan los datos.
 *
 * - `todos_los_principales`: todos los principales deben firmar. Un rechazo de
 *   cualquiera ⇒ `rechazado`; una revocación ⇒ `revocado`; todos firmados ⇒
 *   `firmado`; algunos sí y otros pendientes ⇒ `parcial`; ninguno ⇒ `pendiente`.
 * - `uno_principal` / `cualquiera`: basta uno. Si alguien tiene firma vigente
 *   `firmado` ⇒ `firmado`. Si no, el rechazo prevalece sobre la revocación y
 *   esta sobre el pendiente (señal más fuerte primero).
 *
 * Devuelve también la lista de firmantes requeridos con su decisión vigente
 * (`null` = no se ha pronunciado), para pintar el detalle del roster.
 */
export function calcularEstadoNino(
  politica: PoliticaFirmantes,
  vinculos: FirmanteVinculo[],
  vigentes: Map<string, FirmaEfectiva>
): { estado: EstadoFirmaNino; firmantes: FirmanteRequerido[] } {
  const requeridos = firmantesRequeridos(politica, vinculos)

  const firmantes: FirmanteRequerido[] = requeridos.map((v) => {
    const firma = vigentes.get(v.firmante_id)
    return {
      firmante_id: v.firmante_id,
      firmante_nombre: v.firmante_nombre,
      rol_firmante: v.rol_firmante,
      decision: firma?.decision ?? null,
      firmado_at: firma?.firmado_at ?? null,
    }
  })

  if (firmantes.length === 0) {
    return { estado: 'pendiente', firmantes }
  }

  const decisiones = firmantes.map((f) => f.decision)
  const algun = (d: FirmaDecision) => decisiones.includes(d)
  const todos = (d: FirmaDecision) => decisiones.every((x) => x === d)

  if (politica === 'todos_los_principales') {
    if (algun('rechazado')) return { estado: 'rechazado', firmantes }
    if (algun('revocado')) return { estado: 'revocado', firmantes }
    if (todos('firmado')) return { estado: 'firmado', firmantes }
    if (algun('firmado')) return { estado: 'parcial', firmantes }
    return { estado: 'pendiente', firmantes }
  }

  // uno_principal / cualquiera → basta una firma vigente.
  if (algun('firmado')) return { estado: 'firmado', firmantes }
  if (algun('rechazado')) return { estado: 'rechazado', firmantes }
  if (algun('revocado')) return { estado: 'revocado', firmantes }
  return { estado: 'pendiente', firmantes }
}
