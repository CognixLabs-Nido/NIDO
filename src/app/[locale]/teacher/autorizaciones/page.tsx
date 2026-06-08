import { FileSignatureIcon, PillIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import {
  EstadoDocBadge,
  TipoAutorizacionBadge,
} from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { getAutorizacionesAdmin } from '@/features/autorizaciones/queries/get-autorizaciones-admin'
import type { AutorizacionItem } from '@/features/autorizaciones/types'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Autorizaciones de la profe: recogidas y medicaciones firmadas/firmables de los
 * niños de SU aula (la RLS de `autorizaciones` ya acota el alcance al rol profe).
 * Desde el detalle registra/confirma la administración de medicación (F8-3b). No
 * gestiona el catálogo de plantillas ni el seguimiento de envíos (eso es admin).
 */
export default async function TeacherAutorizacionesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const instancias = await getAutorizacionesAdmin()
  const recogidas = instancias.filter((a) => a.tipo === 'recogida')
  const medicaciones = instancias.filter((a) => a.tipo === 'medicacion')

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <FileSignatureIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('teacher.intro')}</p>
      </header>

      <Seccion
        icon={<UsersIcon className="size-5" />}
        titulo={t('teacher.recogidas_titulo')}
        descripcion={t('teacher.recogidas_desc')}
        items={recogidas}
        vacio={t('teacher.recogidas_vacio')}
        locale={locale}
      />

      <Seccion
        icon={<PillIcon className="size-5" />}
        titulo={t('teacher.medicacion_titulo')}
        descripcion={t('teacher.medicacion_desc')}
        items={medicaciones}
        vacio={t('teacher.medicacion_vacio')}
        locale={locale}
      />
    </div>
  )
}

function Seccion({
  icon,
  titulo,
  descripcion,
  items,
  vacio,
  locale,
}: {
  icon: React.ReactNode
  titulo: string
  descripcion: string
  items: AutorizacionItem[]
  vacio: string
  locale: string
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-h2 text-foreground flex items-center gap-2">
          {icon}
          {titulo}
        </h2>
        <p className="text-muted-foreground text-sm">{descripcion}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{vacio}</p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${locale}/teacher/autorizaciones/${a.id}`}
                className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{a.titulo}</span>
                  <TipoAutorizacionBadge tipo={a.tipo} />
                </span>
                <EstadoDocBadge estado={a.estado} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
