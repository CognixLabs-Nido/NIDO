import {
  BookOpenIcon,
  ChevronLeftIcon,
  HeartIcon,
  InfoIcon,
  UsersIcon,
  GraduationCapIcon,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/server'
import {
  getInfoMedica,
  getMatriculasPorNino,
  getNinoById,
} from '@/features/ninos/queries/get-ninos'
import { DatosPedagogicosTab } from '@/features/datos-pedagogicos/components/DatosPedagogicosTab'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function NinoDetallePage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('admin.ninos')
  const tMed = await getTranslations('medico')
  const nino = await getNinoById(id)
  if (!nino) notFound()

  const supabase = await createClient()
  const [{ data: vinculos }, info, matriculas, datosPed] = await Promise.all([
    supabase
      .from('vinculos_familiares')
      .select('id, tipo_vinculo, parentesco, descripcion_parentesco, usuario_id')
      .eq('nino_id', id)
      .is('deleted_at', null),
    getInfoMedica(id),
    getMatriculasPorNino(id),
    getDatosPedagogicos(id),
  ])

  const matriculaActiva = matriculas.find((m) => m.fecha_baja === null)
  const initials = (nino.nombre.charAt(0) + (nino.apellidos.charAt(0) || '')).toUpperCase() || '?'

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/admin/ninos`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {t('title')}
      </Link>

      <header className="bg-card border-border/60 flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-md">
        <div className="bg-primary-100 text-primary-700 flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 text-foreground truncate">
            {nino.nombre} {nino.apellidos}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('fields.fecha_nacimiento')}: {nino.fecha_nacimiento}
          </p>
        </div>
        {matriculaActiva && <Badge variant="warm">{matriculaActiva.aula_nombre}</Badge>}
      </header>

      <Tabs defaultValue="personales">
        <TabsList>
          <TabsTrigger value="personales">
            <InfoIcon className="size-4" />
            {t('tabs.personales')}
          </TabsTrigger>
          <TabsTrigger value="medica">
            <HeartIcon className="size-4" />
            {t('tabs.medica')}
          </TabsTrigger>
          <TabsTrigger value="pedagogico">
            <BookOpenIcon className="size-4" />
            {t('tabs.pedagogico')}
          </TabsTrigger>
          <TabsTrigger value="vinculos">
            <UsersIcon className="size-4" />
            {t('tabs.vinculos')}
          </TabsTrigger>
          <TabsTrigger value="matriculas">
            <GraduationCapIcon className="size-4" />
            {t('tabs.matriculas')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="personales" className="space-y-3 pt-3">
          <Card>
            <CardContent className="space-y-2 text-sm">
              <Row k={t('fields.nombre')} v={nino.nombre} />
              <Row k={t('fields.apellidos')} v={nino.apellidos} />
              <Row k={t('fields.fecha_nacimiento')} v={nino.fecha_nacimiento} />
              <Row k={t('fields.sexo')} v={nino.sexo ?? '—'} />
              <Row k={t('fields.idioma_principal')} v={nino.idioma_principal} />
              <Row k={t('fields.nacionalidad')} v={nino.nacionalidad ?? '—'} />
              <Row k={t('fields.notas_admin')} v={nino.notas_admin ?? '—'} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="medica" className="space-y-3 pt-3">
          <Card>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground border-info-300 bg-info-100 text-info-700 border-l-4 px-3 py-2 text-xs">
                {tMed('aviso_cifrado')}
              </p>
              {info ? (
                <>
                  <Row k={t('fields.alergias_graves')} v={info.alergias_graves ?? '—'} />
                  <Row k={t('fields.notas_emergencia')} v={info.notas_emergencia ?? '—'} />
                  <Row k={t('fields.medicacion_habitual')} v={info.medicacion_habitual ?? '—'} />
                  <Row k={t('fields.alergias_leves')} v={info.alergias_leves ?? '—'} />
                  <Row k={t('fields.medico_familia')} v={info.medico_familia ?? '—'} />
                  <Row k={t('fields.telefono_emergencia')} v={info.telefono_emergencia ?? '—'} />
                </>
              ) : (
                <EmptyState icon={<HeartIcon strokeWidth={1.75} />} title={t('medica_vacia')} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pedagogico" className="space-y-3 pt-3">
          <DatosPedagogicosTab
            ninoId={id}
            locale={locale}
            initial={
              datosPed
                ? {
                    nino_id: datosPed.nino_id,
                    lactancia_estado: datosPed.lactancia_estado,
                    lactancia_observaciones: datosPed.lactancia_observaciones,
                    control_esfinteres: datosPed.control_esfinteres,
                    control_esfinteres_observaciones: datosPed.control_esfinteres_observaciones,
                    siesta_horario_habitual: datosPed.siesta_horario_habitual,
                    siesta_numero_diario: datosPed.siesta_numero_diario,
                    siesta_observaciones: datosPed.siesta_observaciones,
                    tipo_alimentacion: datosPed.tipo_alimentacion,
                    alimentacion_observaciones: datosPed.alimentacion_observaciones,
                    idiomas_casa: datosPed.idiomas_casa,
                    tiene_hermanos_en_centro: datosPed.tiene_hermanos_en_centro,
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="vinculos" className="pt-3">
          {!vinculos || vinculos.length === 0 ? (
            <Card>
              <EmptyState icon={<UsersIcon strokeWidth={1.75} />} title={t('vinculos_vacios')} />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('fields.tipo_vinculo')}</TableHead>
                    <TableHead>{t('fields.parentesco')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vinculos.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <Badge variant="warm">{v.tipo_vinculo}</Badge>
                      </TableCell>
                      <TableCell>
                        {v.parentesco}
                        {v.descripcion_parentesco ? ` (${v.descripcion_parentesco})` : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="matriculas" className="pt-3">
          {matriculas.length === 0 ? (
            <Card>
              <EmptyState
                icon={<GraduationCapIcon strokeWidth={1.75} />}
                title={t('matriculas_vacias')}
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('fields.aula')}</TableHead>
                    <TableHead>{t('fields.fecha_alta')}</TableHead>
                    <TableHead>{t('fields.fecha_baja')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matriculas.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.aula_nombre}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {m.fecha_alta}
                      </TableCell>
                      <TableCell>
                        {m.fecha_baja ? (
                          <span className="text-muted-foreground text-sm">{m.fecha_baja}</span>
                        ) : (
                          <Badge variant="success">·</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-dashed border-neutral-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-muted-foreground w-48 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
