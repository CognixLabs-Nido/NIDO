import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

import {
  agruparPorCurso,
  cursosParaSubir,
  sePuedeCambiarDeCurso,
  sePuedeOfrecerBorrar,
  type CursoDeLaPantalla,
  type DocumentoAdmin,
} from '../lib/pantalla'
import type { PantallaDocumentos } from '../queries/get-documentos-admin'
import { BorrarVersionDialog } from './BorrarVersionDialog'
import { DocumentoDialog } from './DocumentoDialog'
import { RetirarDocumentoBoton } from './RetirarDocumentoBoton'
import { SubirVersionDialog } from './SubirVersionDialog'

interface Props {
  locale: string
  centroId: string
  pantalla: PantallaDocumentos
}

/**
 * La lista de la admin (3c): cada documento con sus versiones agrupadas por curso. Hay varias vivas
 * a la vez, una por curso, y se enseñan así: la vigente de cada curso, no «la vigente» del documento.
 */
export async function DocumentosCentroLista({ locale, centroId, pantalla }: Props) {
  const t = await getTranslations('documentos_centro.pantalla')
  const { documentos } = pantalla.lista
  if (documentos.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon strokeWidth={1.75} />}
        title={t('vacio_titulo')}
        description={t('vacio_texto')}
      />
    )
  }
  const paraSubir = cursosParaSubir(pantalla.cursos)
  return (
    <div className="space-y-4">
      {documentos.map((doc) => (
        <DocumentoCard
          key={doc.id}
          locale={locale}
          centroId={centroId}
          doc={doc}
          cursos={pantalla.cursos}
          paraSubir={paraSubir}
          firmas={pantalla.firmas}
        />
      ))}
    </div>
  )
}

async function DocumentoCard({
  locale,
  centroId,
  doc,
  cursos,
  paraSubir,
  firmas,
}: {
  locale: string
  centroId: string
  doc: DocumentoAdmin
  cursos: CursoDeLaPantalla[]
  paraSubir: CursoDeLaPantalla[]
  firmas: Record<string, number>
}) {
  const t = await getTranslations('documentos_centro.pantalla')
  const format = await getFormatter()
  const retirado = doc.retirado_at !== null
  const grupos = agruparPorCurso(doc.versiones, cursos)

  return (
    <Card className={retirado ? 'opacity-70' : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>{doc.titulo}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={doc.de_curso ? 'info' : 'secondary'}>
              {t(doc.de_curso ? 'de_curso' : 'no_de_curso')}
            </Badge>
            <Badge variant={doc.obligatorio ? 'warm' : 'outline'}>
              {t(doc.obligatorio ? 'obligatorio' : 'opcional')}
            </Badge>
            {retirado && <Badge variant="destructive">{t('retirado')}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!retirado && (
            <SubirVersionDialog
              locale={locale}
              centroId={centroId}
              documentoId={doc.id}
              deCurso={doc.de_curso}
              cursos={paraSubir}
            />
          )}
          <DocumentoDialog
            centroId={centroId}
            documento={{
              id: doc.id,
              titulo: doc.titulo,
              deCurso: doc.de_curso,
              obligatorio: doc.obligatorio,
              orden: doc.orden,
            }}
            puedeCambiarDeCurso={sePuedeCambiarDeCurso(doc)}
          />
          <RetirarDocumentoBoton documentoId={doc.id} retirado={retirado} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {grupos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_versiones')}</p>
        ) : (
          grupos.map((g) => (
            <section key={g.cursoId ?? 'sin-curso'} className="space-y-2">
              {doc.de_curso && (
                <h3 className="text-foreground text-sm font-medium">
                  {g.cursoNombre ?? t('curso_desconocido')}
                </h3>
              )}
              <ul className="divide-border divide-y rounded-lg border">
                {g.versiones.map((v) => {
                  const n = firmas[v.id] ?? 0
                  return (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t('version', { numero: v.numero })}</span>
                        {v.vigente && <Badge variant="success">{t('vigente')}</Badge>}
                        <span className="text-muted-foreground">
                          {format.dateTime(new Date(v.subida_at), { dateStyle: 'medium' })} ·{' '}
                          {t('tamano_kb', { kb: Math.max(1, Math.round(v.bytes / 1024)) })} ·{' '}
                          {t('firmas', { n })}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <a
                          href={`/${locale}/admin/documentos-centro/version/${v.id}?centro=${centroId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                        >
                          {t('ver_pdf')}
                          <ExternalLinkIcon className="size-3.5" />
                        </a>
                        {sePuedeOfrecerBorrar(firmas, v.id) && (
                          <BorrarVersionDialog versionId={v.id} numero={v.numero} />
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  )
}
