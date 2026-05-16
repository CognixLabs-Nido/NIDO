import { BabyIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { ProximosDiasCerradosWidget } from '@/features/calendario-centro/components/ProximosDiasCerradosWidget'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { EmptyState } from '@/shared/components/EmptyState'
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
  const centroId = await getCentroActualId()

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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      {centroId && <ProximosDiasCerradosWidget centroId={centroId} />}
      {ninos.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BabyIcon strokeWidth={1.75} />}
              title={t('ningun_nino')}
              description={t('ningun_nino_descripcion')}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ninos.map((n) => {
            const initials =
              (n.nombre.charAt(0) + (n.apellidos.charAt(0) || '')).toUpperCase() || '?'
            return (
              <Link
                key={n.id}
                href={`/${locale}/family/nino/${n.id}`}
                className="focus-visible:ring-ring rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="hover:border-primary-200 h-full transition hover:shadow-lg">
                  <CardContent className="flex items-center gap-4">
                    <div className="bg-primary-100 text-primary-700 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-foreground truncate text-lg font-semibold">
                        {n.nombre} {n.apellidos}
                      </h2>
                      <p className="text-muted-foreground mt-0.5 text-sm">{t('ver_ficha')}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
