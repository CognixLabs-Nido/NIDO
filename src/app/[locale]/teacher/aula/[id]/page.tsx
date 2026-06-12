import { ChevronLeftIcon, ClipboardCheckIcon, ImagePlusIcon, UtensilsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { AgendaAulaCliente } from '@/features/agenda-diaria/components/AgendaAulaCliente'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAgendasAulaDelDia } from '@/features/agenda-diaria/queries/get-agendas-aula-del-dia'
import { getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import {
  getVinculosTutoresAula,
  type VinculoTutorMin,
} from '@/features/messaging/queries/get-vinculos-tutores-aula'
import { NuevoRecordatorioContextual } from '@/features/recordatorios/components/NuevoRecordatorioContextual'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function TeacherAulaPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams
  const t = await getTranslations('teacher.aula')
  const tNav = await getTranslations('teacher.nav')
  const tAsistencia = await getTranslations('asistencia')
  const tMenus = await getTranslations('menus.pase_de_lista')
  const tFotos = await getTranslations('fotos')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  // Default: hoy hora Madrid. Si llega ?fecha=YYYY-MM-DD válida, la usamos;
  // un valor inválido cae a hoy.
  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()

  // F5B-#33: la página /teacher/aula/[id] la usan tanto profe como admin
  // (admin reusa la ruta — no hay /admin/aula/[id] paralelo). El rol
  // determina qué renderiza NinoAgendaCard en su slot "Escribir a la
  // familia":
  //   - profe → Link legacy al redirector /messages/nino/<id>.
  //   - admin → EscribirAFamiliaAdminPicker (Dialog si ≥2 tutores) que
  //     redirige al SplitView del PR #32 con tutor preseleccionado.
  // La query de vínculos SOLO se ejecuta para admin (gating cliente, no
  // de seguridad; RLS es la verdadera barrera). Profe ahorra IO.
  const rolRaw = await getRolEnCentro(aula.centro_id)
  const rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado' =
    rolRaw === 'admin' || rolRaw === 'profe' || rolRaw === 'tutor_legal' || rolRaw === 'autorizado'
      ? rolRaw
      : 'profe'

  // Promise.all: paralelizamos la agenda con los vínculos (admin) o con
  // una resolved promise vacía (profe). Lección PR #32.
  const [resumenes, vinculosPorNino]: [
    Awaited<ReturnType<typeof getAgendasAulaDelDia>>,
    Map<string, VinculoTutorMin[]> | undefined,
  ] = await Promise.all([
    getAgendasAulaDelDia(id, fecha),
    rol === 'admin' ? getVinculosTutoresAula(id) : Promise.resolve(undefined),
  ])

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground">{aula.nombre}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('cohorte_label')}:</span>
          {aula.cohorte_anos_nacimiento.map((y) => (
            <Badge key={y} variant="warm">
              {y}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href={`/${locale}/teacher/aula/${id}/asistencia`}
            data-testid="link-asistencia"
            className="border-border bg-background hover:bg-muted text-foreground inline-flex h-7 items-center gap-1 rounded-xl border px-2.5 text-[0.8rem] font-medium transition-colors"
          >
            <ClipboardCheckIcon className="size-3.5" />
            {tAsistencia('ver')}
          </Link>
          <Link
            href={`/${locale}/teacher/aula/${id}/comida`}
            data-testid="link-comida"
            className="border-border bg-background hover:bg-muted text-foreground inline-flex h-7 items-center gap-1 rounded-xl border px-2.5 text-[0.8rem] font-medium transition-colors"
          >
            <UtensilsIcon className="size-3.5" />
            {tMenus('ver')}
          </Link>
          <Link
            href={`/${locale}/teacher/aula/${id}/fotos`}
            data-testid="link-fotos"
            className="border-border bg-background hover:bg-muted text-foreground inline-flex h-7 items-center gap-1 rounded-xl border px-2.5 text-[0.8rem] font-medium transition-colors"
          >
            <ImagePlusIcon className="size-3.5" />
            {tFotos('ver')}
          </Link>
          {/* F6-C-3: recordatorio "a las familias de esta aula", con destino +
              aula preseleccionados. Solo staff (admin/profe) crea. */}
          {(rol === 'admin' || rol === 'profe') && (
            <NuevoRecordatorioContextual
              locale={locale}
              rol={rol}
              centroId={aula.centro_id}
              preset={{ destinatario: 'familias_aula', aula_id: id }}
            />
          )}
        </div>
      </header>

      <AgendaAulaCliente
        aulaId={id}
        locale={locale}
        fecha={fecha}
        resumenes={resumenes}
        rol={rol}
        vinculosPorNino={vinculosPorNino}
      />
    </div>
  )
}
