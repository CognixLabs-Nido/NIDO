import type { Database } from '@/types/database'

type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

/**
 * ¿Quien hace el alta puede dar el consentimiento de imagen del niño? Solo su tutor LEGAL
 * (principal/secundario) o Dirección en modo Dirección (firma presencial). Un vínculo
 * `autorizado` (persona de recogida) no: el alta le oculta la sección de imagen entera
 * (documento, «Cargar documento» y casilla) en vez de dejarle marcarla y recibir un 42501
 * (las RPCs y `firma_imagen_sync` exigen tutor legal o Dirección presencial).
 */
export function puedeConsentirImagenAlta(input: {
  modoDireccion: boolean
  tipoVinculo: TipoVinculo | null
}): boolean {
  if (input.modoDireccion) return true
  return (
    input.tipoVinculo === 'tutor_legal_principal' || input.tipoVinculo === 'tutor_legal_secundario'
  )
}
