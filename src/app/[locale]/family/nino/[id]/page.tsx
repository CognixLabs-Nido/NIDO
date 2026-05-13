import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getInfoMedica, getNinoById } from '@/features/ninos/queries/get-ninos'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FamilyNinoPage({ params }: PageProps) {
  const { id } = await params
  const t = await getTranslations('family.nino')
  const nino = await getNinoById(id)
  if (!nino) notFound()

  // Si el vínculo tiene puede_ver_info_medica, get_info_medica_emergencia
  // devuelve la fila; si no, lanza excepción y getInfoMedica devuelve null.
  let infoMedica = null
  try {
    infoMedica = await getInfoMedica(id)
  } catch {
    infoMedica = null
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id

  let permisos: Record<string, boolean> = {}
  if (userId) {
    const { data: vinculo } = await supabase
      .from('vinculos_familiares')
      .select('permisos')
      .eq('usuario_id', userId)
      .eq('nino_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    permisos = (vinculo?.permisos as Record<string, boolean> | null) ?? {}
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-3xl font-semibold">
          {nino.nombre} {nino.apellidos}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('basicos')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row k={t('fecha_nacimiento')} v={nino.fecha_nacimiento} />
          <Row k={t('idioma_principal')} v={nino.idioma_principal} />
          <Row k={t('nacionalidad')} v={nino.nacionalidad ?? '—'} />
        </CardContent>
      </Card>

      {permisos.puede_ver_info_medica && infoMedica && (
        <Card>
          <CardHeader>
            <CardTitle>{t('info_medica')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k={t('alergias_graves')} v={infoMedica.alergias_graves ?? '—'} />
            <Row k={t('notas_emergencia')} v={infoMedica.notas_emergencia ?? '—'} />
            <Row k={t('medicacion_habitual')} v={infoMedica.medicacion_habitual ?? '—'} />
            <Row k={t('telefono_emergencia')} v={infoMedica.telefono_emergencia ?? '—'} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4">
      <span className="text-muted-foreground w-40 shrink-0 text-xs">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  )
}
