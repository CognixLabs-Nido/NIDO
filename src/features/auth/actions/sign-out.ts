'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { COOKIE_CENTRO_ACTIVO } from '@/features/centros/contexto/cookie'
import { createClient } from '@/lib/supabase/server'

export async function signOut(locale: string = 'es'): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // El centro activo es de esta sesión: el siguiente que entre en el navegador elige el suyo.
  ;(await cookies()).delete(COOKIE_CENTRO_ACTIVO)
  redirect(`/${locale}/login`)
}
