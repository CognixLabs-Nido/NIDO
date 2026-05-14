import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

export interface CentroLogoInfo {
  logoUrl: string
  nombre: string
}

/**
 * Devuelve el logo + nombre del centro. Server-only, cacheado por request
 * con React `cache()` para que se llame una sola vez aunque varios layouts
 * lo necesiten en la misma render.
 */
export const getCentroLogo = cache(async (centroId: string): Promise<CentroLogoInfo | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('centros')
    .select('logo_url, nombre')
    .eq('id', centroId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data || !data.logo_url) return null
  return { logoUrl: data.logo_url, nombre: data.nombre }
})
