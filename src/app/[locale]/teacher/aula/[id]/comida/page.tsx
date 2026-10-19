import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { AvisoCentroDistinto } from '@/features/centros/components/AvisoCentroDistinto'
import { contextoEnCentro } from '@/features/centros/contexto/get-contexto-centro'
import { PaseDeListaComidaCliente } from '@/features/menus/components/PaseDeListaComidaCliente'
import { getPaseDeListaComidaTodosMomentos } from '@/features/menus/queries/get-pase-de-lista-comida-todos-momentos'
import type { MomentoComida } from '@/features/menus/types'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ fecha?: string; momento?: string }>
}

const MOMENTOS_VALIDOS: MomentoComida[] = ['desayuno', 'media_manana', 'comida', 'merienda']

export default async function TeacherComidaPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params
  const { fecha: fechaQ, momento: momentoQ } = await searchParams
  const tNav = await getTranslations('teacher.nav')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  // Rol en el CENTRO DEL AULA (antes, en el centro activo, sin mirar de qué centro era el aula). La
  // página se ve aunque no sea el centro activo; la cabecera lo avisa.
  const rol = (await contextoEnCentro(aula.centro_id))?.rol ?? null
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const fecha = fechaQ && /^\d{4}-\d{2}-\d{2}$/.test(fechaQ) ? fechaQ : hoyMadrid()
  const momentoInicial: MomentoComida =
    momentoQ && (MOMENTOS_VALIDOS as string[]).includes(momentoQ)
      ? (momentoQ as MomentoComida)
      : 'comida'

  // Carga los 4 momentos de una vez (1 pasada server-side eficiente).
  // El cliente cambia de momento como state local — sin re-fetch.
  const states = await getPaseDeListaComidaTodosMomentos(id, fecha)

  return (
    <div className="space-y-6">
      <AvisoCentroDistinto centroRegistroId={aula.centro_id} />
      <Link
        href={`/${locale}/teacher/aula/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>
      <PaseDeListaComidaCliente
        aulaId={id}
        fecha={fecha}
        momentoInicial={momentoInicial}
        states={states}
        locale={locale}
      />
    </div>
  )
}
