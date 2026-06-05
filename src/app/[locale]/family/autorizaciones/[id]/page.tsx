import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { FirmarAutorizacionPanel } from '@/features/autorizaciones/components/FirmarAutorizacionPanel'
import { getAutorizacionDetalle } from '@/features/autorizaciones/queries/get-autorizacion-detalle'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function FamilyAutorizacionDetallePage({ params }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'tutor_legal' && rol !== 'autorizado') redirect(`/${locale}/forbidden`)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()

  const aut = await getAutorizacionDetalle(id)
  if (!aut) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/family/autorizaciones`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{aut.titulo}</h1>
        <p className="text-muted-foreground text-xs">
          {t('detalle.version', { v: aut.texto_version })}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-h3">{t('detalle.texto')}</h2>
        <div className="bg-muted/40 rounded-lg border p-4 text-sm whitespace-pre-wrap">
          {aut.texto === 'PENDIENTE' ? (
            <span className="text-muted-foreground">{t('detalle.texto_pendiente')}</span>
          ) : (
            aut.texto
          )}
        </div>
        <p className="text-muted-foreground text-xs">{t('aviso_legal')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">{t('detalle.tu_firma')}</h2>
        <FirmarAutorizacionPanel
          autorizacionId={aut.id}
          firmable={aut.firmable}
          roster={aut.roster}
          currentUserId={user.id}
          currentUserNombre={perfil?.nombre_completo ?? ''}
        />
      </section>
    </div>
  )
}
