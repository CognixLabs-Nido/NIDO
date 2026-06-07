import { FileSignatureIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CrearRecogidaDialog } from '@/features/autorizaciones/components/CrearRecogidaDialog'
import {
  EstadoFirmaBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { getAutorizacionesFamilia } from '@/features/autorizaciones/queries/get-autorizaciones-familia'
import { getRecogidaContextoFamilia } from '@/features/autorizaciones/queries/get-recogida-familia'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function FamilyAutorizacionesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'tutor_legal' && rol !== 'autorizado') redirect(`/${locale}/forbidden`)

  const [autorizaciones, recogida] = await Promise.all([
    getAutorizacionesFamilia(),
    getRecogidaContextoFamilia(),
  ])

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: perfil } = user
    ? await supabase.from('usuarios').select('nombre_completo').eq('id', user.id).maybeSingle()
    : { data: null }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <FileSignatureIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('family_intro')}</p>
        </div>
        {recogida.plantillaDisponible && recogida.ninos.length > 0 && (
          <CrearRecogidaDialog
            ninos={recogida.ninos}
            prefillPorNino={recogida.prefillPorNino}
            currentUserNombre={perfil?.nombre_completo ?? ''}
          />
        )}
      </header>

      {autorizaciones.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('lista.vacia_familia')}</p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {autorizaciones.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${locale}/family/autorizaciones/${a.id}`}
                className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{a.titulo}</span>
                  <TipoAutorizacionBadge tipo={a.tipo} />
                </span>
                {a.estado_firma && <EstadoFirmaBadge estado={a.estado_firma} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
