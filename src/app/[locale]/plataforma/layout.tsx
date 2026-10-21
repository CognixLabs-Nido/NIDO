import { redirect } from 'next/navigation'

import { esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * El panel de plataforma es solo del superusuario (Fase 5, ADR-0061). El proxy ya lo gatea
 * (`esRutaDePlataforma`); esta es la defensa en profundidad que pide `proxy-roles.ts` para cada
 * espacio de primer nivel. No lee ningún centro: el superusuario está fuera de todos.
 */
export default async function PlataformaLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)
  if (!(await esSuperusuario(supabase))) redirect(`/${locale}/forbidden`)
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">{children}</div>
}
