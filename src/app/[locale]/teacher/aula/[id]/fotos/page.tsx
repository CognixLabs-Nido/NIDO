import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/lib/supabase/server'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { BlogAulaCliente } from '@/features/fotos/components/BlogAulaCliente'
import { getNinosAulaParaFotos } from '@/features/fotos/queries/get-ninos-etiquetables'
import { getPublicacionesAula } from '@/features/fotos/queries/get-publicaciones-aula'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

/** Roles de personal del aula que pueden publicar/etiquetar (P5; espejo de F9). */
const REDACTORES = new Set(['coordinadora', 'profesora'])

/**
 * Blog del aula — vista de **staff** (F10-1). La profe (coordinadora/profesora)
 * y el admin del centro crean/editan/borran publicaciones con fotos y etiquetan
 * a los niños con permiso. Técnico/apoyo solo leen (no ven el botón de publicar;
 * la RLS es la barrera real). La vista de familia es F10-2.
 */
export default async function FotosAulaPage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('fotos')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // ¿Puede publicar? Admin del centro o coordinadora/profesora de ESTE aula.
  const rol = await getRolEnCentro(aula.centro_id)
  let puedePublicar = rol === 'admin'
  if (!puedePublicar) {
    const { data: pa } = await supabase
      .from('profes_aulas')
      .select('tipo_personal_aula')
      .eq('profe_id', user.id)
      .eq('aula_id', id)
      .is('fecha_fin', null)
      .is('deleted_at', null)
      .maybeSingle()
    puedePublicar = REDACTORES.has(pa?.tipo_personal_aula ?? '')
  }

  const [publicaciones, ninos] = await Promise.all([
    getPublicacionesAula(id, aula.centro_id),
    getNinosAulaParaFotos(id),
  ])

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher/aula/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {aula.nombre}
      </Link>
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitulo')}</p>
      </header>

      <BlogAulaCliente
        locale={locale}
        aulaId={id}
        ninos={ninos}
        puedePublicar={puedePublicar}
        publicaciones={publicaciones}
      />
    </div>
  )
}
