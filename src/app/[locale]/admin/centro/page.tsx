import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EditarCentroDialog } from '@/features/centros/components/EditarCentroDialog'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'

export default async function AdminCentroPage() {
  const t = await getTranslations('admin.centro')
  const supabase = await createClient()
  const centroId = (await getCentroActualId())!

  const { data: centro } = await supabase
    .from('centros')
    .select('id, nombre, direccion, telefono, email_contacto, web, idioma_default')
    .eq('id', centroId)
    .single()

  if (!centro) {
    return <p className="text-muted-foreground">{t('not_found')}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <EditarCentroDialog
          centroId={centro.id}
          initial={{
            nombre: centro.nombre,
            direccion: centro.direccion,
            telefono: centro.telefono,
            email_contacto: centro.email_contacto,
            web: centro.web,
            idioma_default: centro.idioma_default as 'es' | 'en' | 'va',
          }}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{centro.nombre}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label={t('fields.direccion')} value={centro.direccion} />
          <Row label={t('fields.telefono')} value={centro.telefono} />
          <Row label={t('fields.email_contacto')} value={centro.email_contacto} />
          <Row label={t('fields.web')} value={centro.web ?? '—'} />
          <Row label={t('fields.idioma_default')} value={centro.idioma_default} />
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="text-muted-foreground w-40 shrink-0 text-xs">{label}</span>
      <span>{value}</span>
    </div>
  )
}
