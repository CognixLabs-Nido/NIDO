import { ImageIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { FotosFamiliaFeed } from '@/features/fotos/components/FotosFamiliaFeed'
import { getPublicacionesFamilia } from '@/features/fotos/queries/get-publicaciones-familia'
import { MarcarFotosVistasOnMount } from '@/features/notificaciones/components/MarcarFotosVistasOnMount'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Vista de FAMILIA del blog del aula (F10-2): solo lectura. La RLS decide qué ve la
 * familia (blog del aula actual con `puede_ver_fotos` — P2 — + publicaciones pasadas
 * donde un hijo está etiquetado — P-histórico). Sin permiso, la query devuelve []. Al
 * cargar, marca como vistas las publicaciones mostradas (baja el aviso de INICIO, P8).
 */
export default async function FamilyFotosPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('fotos')
  const publicaciones = await getPublicacionesFamilia()

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('family.titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('family.subtitulo')}</p>
      </header>

      {publicaciones.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={<ImageIcon strokeWidth={1.75} />} title={t('family.vacia')} />
          </CardContent>
        </Card>
      ) : (
        <>
          <MarcarFotosVistasOnMount ids={publicaciones.map((p) => p.id)} />
          <FotosFamiliaFeed locale={locale} publicaciones={publicaciones} />
        </>
      )}
    </div>
  )
}
