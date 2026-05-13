import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function NinoDetallePage({ params }: PageProps) {
  const { id } = await params
  const t = await getTranslations('admin.ninos')
  const tMed = await getTranslations('medico')
  const nino = await getNinoById(id)
  if (!nino) notFound()

  const supabase = await createClient()
  const [{ data: vinculos }, info, matriculas] = await Promise.all([
    supabase
      .from('vinculos_familiares')
      .select('id, tipo_vinculo, parentesco, descripcion_parentesco, usuario_id')
      .eq('nino_id', id)
      .is('deleted_at', null),
    getInfoMedica(id),
    getMatriculasPorNino(id),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">
          {nino.nombre} {nino.apellidos}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t('fields.fecha_nacimiento')}: {nino.fecha_nacimiento}
        </p>
      </header>

      <Tabs defaultValue="personales">
        <TabsList>
          <TabsTrigger value="personales">{t('tabs.personales')}</TabsTrigger>
          <TabsTrigger value="medica">{t('tabs.medica')}</TabsTrigger>
          <TabsTrigger value="vinculos">{t('tabs.vinculos')}</TabsTrigger>
          <TabsTrigger value="matriculas">{t('tabs.matriculas')}</TabsTrigger>
        </TabsList>

        <TabsContent value="personales" className="space-y-3">
          <Card>
            <CardContent className="space-y-2 pt-4 text-sm">
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

        <TabsContent value="medica" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tMed('aviso_cifrado')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
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
                <p className="text-muted-foreground">{t('medica_vacia')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vinculos">
          {!vinculos || vinculos.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('vinculos_vacios')}</p>
          ) : (
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
                    <TableCell>{v.tipo_vinculo}</TableCell>
                    <TableCell>
                      {v.parentesco}
                      {v.descripcion_parentesco ? ` (${v.descripcion_parentesco})` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="matriculas">
          {matriculas.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('matriculas_vacias')}</p>
          ) : (
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
                    <TableCell>{m.aula_nombre}</TableCell>
                    <TableCell>{m.fecha_alta}</TableCell>
                    <TableCell>{m.fecha_baja ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4">
      <span className="text-muted-foreground w-44 shrink-0 text-xs">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  )
}
