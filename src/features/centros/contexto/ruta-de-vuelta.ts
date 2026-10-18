import { rutaInterna } from '@/shared/lib/ruta-interna'

/**
 * Destino tras elegir centro: una ruta interna (`rutaInterna`) que no sea el propio selector;
 * si no, el reparto por rol.
 */
export function rutaDeVuelta(locale: string, returnTo: string | null | undefined): string {
  const porDefecto = `/${locale}/select-role`
  const ruta = rutaInterna(locale, returnTo)
  if (!ruta || ruta.startsWith(`/${locale}/elegir-centro`)) return porDefecto
  return ruta
}
