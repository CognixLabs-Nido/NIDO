import type { RecordatorioDestinatarioInput } from '../schemas/recordatorios'
import { VENTANA_ANULACION_MS } from './constants'

type RolUsuario = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

/**
 * Destinos que un rol puede CREAR (matriz D9 de la spec F6-C). El módulo de
 * creación es solo admin/profe; tutor_legal/autorizado solo RECIBEN (lista vacía
 * → el form no se les muestra).
 *
 *  - admin → los 6 destinos.
 *  - profe → familia_individual (su niño), familias_aula (su aula), personal.
 *    NO familias_centro / profe_individual / profes_centro (D3: sin profe→profe,
 *    sin broadcast a todo el centro desde profe).
 *  - tutor_legal/autorizado → `[]`.
 */
export function destinosParaRol(rol: RolUsuario): RecordatorioDestinatarioInput[] {
  if (rol === 'admin') {
    return [
      'familia_individual',
      'familias_aula',
      'familias_centro',
      'profe_individual',
      'profes_centro',
      'personal',
    ]
  }
  if (rol === 'profe') {
    return ['familia_individual', 'familias_aula', 'personal']
  }
  return []
}

/** familia_individual lleva un niño concreto (nino_id). */
export function requiereNino(destino: RecordatorioDestinatarioInput): boolean {
  return destino === 'familia_individual'
}

/** familias_aula lleva un aula concreta (aula_id). */
export function requiereAula(destino: RecordatorioDestinatarioInput): boolean {
  return destino === 'familias_aula'
}

/** profe_individual lleva una profesora concreta (usuario_destinatario_id). */
export function requiereUsuario(destino: RecordatorioDestinatarioInput): boolean {
  return destino === 'profe_individual'
}

/**
 * Preselección contextual del form (F6-C-3): entry points que abren el Dialog
 * con un destino y su referencia ya fijados. Es CONVENIENCIA, no candado — el
 * usuario puede cambiar el destino tras abrir.
 *  - ficha de niño  → { destinatario: 'familia_individual', nino_id }
 *  - aula           → { destinatario: 'familias_aula', aula_id }
 */
export interface RecordatorioPreset {
  destinatario: RecordatorioDestinatarioInput
  nino_id?: string | null
  aula_id?: string | null
}

export interface RecordatorioFormDefaults {
  destinatario: RecordatorioDestinatarioInput
  nino_id: string | null
  aula_id: string | null
  usuario_destinatario_id: string | null
  titulo: string
  descripcion: string
  vencimiento: string
}

/**
 * Valores iniciales del form de creación. Si hay `preset`, preselecciona su
 * destino + referencia; si no, cae al primer destino del rol (o `personal`).
 * Pura y testeable — el Dialog la usa como `defaultValues`.
 */
export function recordatorioFormDefaults(
  destinos: RecordatorioDestinatarioInput[],
  preset?: RecordatorioPreset
): RecordatorioFormDefaults {
  return {
    destinatario: preset?.destinatario ?? destinos[0] ?? 'personal',
    nino_id: preset?.nino_id ?? null,
    aula_id: preset?.aula_id ?? null,
    usuario_destinatario_id: null,
    titulo: '',
    descripcion: '',
    vencimiento: '',
  }
}

/**
 * ¿Puede el usuario `userId` anular este recordatorio AHORA? Solo el emisor,
 * dentro de la ventana de 5 min, y si no está ya anulado/completado. Misma
 * regla que enforza `anularRecordatorioCore`; aquí decide si el botón se
 * muestra. `nowMs` inyectable para tests.
 */
export function puedeAnular(
  rec: { creado_por: string; created_at: string; erroneo: boolean; completado_en: string | null },
  userId: string,
  nowMs: number = Date.now()
): boolean {
  if (rec.creado_por !== userId) return false
  if (rec.erroneo || rec.completado_en) return false
  return nowMs - new Date(rec.created_at).getTime() <= VENTANA_ANULACION_MS
}

/**
 * Convierte el valor de un `<input type="datetime-local">` (string local
 * 'YYYY-MM-DDTHH:mm', sin zona) a ISO con offset para el schema. En el piloto
 * ANAIA el navegador está en huso Europe/Madrid, así que `new Date(local)`
 * interpreta el valor como hora de Madrid y `toISOString()` da el UTC correcto.
 * Devuelve null si está vacío o es inválido.
 */
export function datetimeLocalAIso(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
