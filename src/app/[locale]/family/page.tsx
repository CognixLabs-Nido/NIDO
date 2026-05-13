import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function FamilyDashboard({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('family.dashboard')
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id

  type NinoRow = { id: string; nombre: string; apellidos: string }
  let ninos: NinoRow[] = []
  if (userId) {
    const { data } = await supabase
      .from('vinculos_familiares')
      .select('ninos(id, nombre, apellidos)')
      .eq('usuario_id', userId)
      .is('deleted_at', null)
    ninos = (data ?? [])
      .map((r): NinoRow | null => {
        const raw = r.ninos as NinoRow | NinoRow[] | null
        if (!raw) return null
        if (Array.isArray(raw)) return raw[0] ?? null
        return raw
      })
      .filter((n): n is NinoRow => n !== null)
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      {ninos.length === 0 ? (
        <p className="text-muted-foreground mt-6">{t('ningun_nino')}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ninos.map((n) => (
            <Link key={n.id} href={`/${locale}/family/nino/${n.id}`}>
              <Card className="cursor-pointer transition hover:shadow-md">
                <CardHeader>
                  <CardTitle>
                    {n.nombre} {n.apellidos}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-xs">{t('ver_ficha')}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
