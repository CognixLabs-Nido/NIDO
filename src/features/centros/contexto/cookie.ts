/**
 * Cookie del centro activo (multicentro · Fase 1). Solo guarda el id del centro que el usuario
 * eligió; NO es una autorización: cada lectura la valida contra los centros del usuario
 * (`resolverCentroActivo`), y la BD autoriza por RLS igualmente.
 *
 * La escribe SOLO la acción `elegirCentro`, nunca el render de una página: reescribir una cookie
 * mientras se pinta da un 500 en Next (MisterFC #756). Una cookie caducada o ajena simplemente
 * no vale y se ignora.
 */
export const COOKIE_CENTRO_ACTIVO = 'nido_centro_activo'

export const OPCIONES_COOKIE_CENTRO_ACTIVO = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}
