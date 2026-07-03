import { FileTextIcon, UserIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

import type { AltaDocumentacion, TutorAltaItem } from '../queries/get-alta-documentacion'

function fmtFecha(iso: string | null, locale: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(locale)
}

function direccionLinea(t: TutorAltaItem): string {
  const calle = [t.direccion_calle, t.direccion_numero].filter(Boolean).join(' ')
  const ciudad = [t.direccion_cp, t.direccion_ciudad].filter(Boolean).join(' ')
  const linea = [calle, ciudad].filter(Boolean).join(', ')
  return linea || '—'
}

/**
 * PR-4g — pestaña "Alta / Documentación" del panel de Dirección: tutores (con
 * dirección y DNI), mandato SEPA (SIN IBAN), consentimiento de datos médicos y
 * documentos privados con enlace firmado. Solo lectura.
 */
export async function AltaDocumentacionTab({
  data,
  locale,
}: {
  data: AltaDocumentacion
  locale: string
}) {
  const t = await getTranslations('admin.ninos')
  const { tutores, mandato, consentimientoMedico, libroFamiliaUrl } = data

  return (
    <div className="space-y-4">
      {/* Tutores */}
      <section className="space-y-3">
        <h3 className="text-h3 text-foreground">{t('alta_doc.tutores_titulo')}</h3>
        {tutores.length === 0 ? (
          <Card>
            <EmptyState icon={<UserIcon strokeWidth={1.75} />} title={t('alta_doc.sin_tutores')} />
          </Card>
        ) : (
          tutores.map((tu) => (
            <Card key={tu.id}>
              <CardContent className="space-y-2 pt-1 text-sm">
                <Badge variant="warm" className="w-fit">
                  {t(`alta_doc.${tu.tipo_vinculo}`)}
                </Badge>
                <Row k={t('fields.nombre')} v={tu.nombre_completo ?? '—'} />
                <Row k={t('alta_doc.email')} v={tu.email ?? '—'} />
                <Row k={t('alta_doc.direccion')} v={direccionLinea(tu)} />
                <Row
                  k={t('alta_doc.dni')}
                  v={
                    tu.dni_url ? (
                      <DocLink href={tu.dni_url} label={t('alta_doc.ver_documento')} />
                    ) : (
                      '—'
                    )
                  }
                />
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {/* SEPA (sin IBAN) */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-h3 text-foreground">{t('alta_doc.sepa_titulo')}</h3>
        {!mandato ? (
          <Card>
            <EmptyState
              icon={<FileTextIcon strokeWidth={1.75} />}
              title={t('alta_doc.sepa_sin_mandato')}
            />
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-2 pt-1 text-sm">
              <Row
                k={t('alta_doc.sepa_estado')}
                v={
                  <Badge
                    variant={mandato.estado === 'activo' ? 'success' : 'warm'}
                    className="w-fit"
                  >
                    {t(`alta_doc.estado_${mandato.estado}`)}
                  </Badge>
                }
              />
              <Row k={t('alta_doc.sepa_titular')} v={mandato.titular ?? '—'} />
              <Row k={t('alta_doc.sepa_identificador')} v={mandato.identificador_mandato} />
              <Row k={t('alta_doc.sepa_fecha_firma')} v={fmtFecha(mandato.fecha_firma, locale)} />
              <Row
                k={t('alta_doc.sepa_documento')}
                v={
                  mandato.pdf_url ? (
                    <DocLink href={mandato.pdf_url} label={t('alta_doc.ver_documento')} />
                  ) : (
                    '—'
                  )
                }
              />
            </CardContent>
          </Card>
        )}
      </section>

      {/* Consentimiento de datos médicos */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-h3 text-foreground">{t('alta_doc.consent_titulo')}</h3>
        <Card>
          <CardContent className="space-y-2 pt-1 text-sm">
            {consentimientoMedico ? (
              <>
                <Row k={t('alta_doc.consent_medico')} v={t('alta_doc.consent_otorgado')} />
                <Row k={t('alta_doc.consent_version')} v={consentimientoMedico.version} />
                <Row
                  k={t('alta_doc.consent_fecha')}
                  v={fmtFecha(consentimientoMedico.aceptado_en, locale)}
                />
              </>
            ) : (
              <Row k={t('alta_doc.consent_medico')} v={t('alta_doc.consent_sin')} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Documentos */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-h3 text-foreground">{t('alta_doc.documentos_titulo')}</h3>
        <Card>
          <CardContent className="space-y-2 pt-1 text-sm">
            <Row
              k={t('alta_doc.doc_libro_familia')}
              v={
                libroFamiliaUrl ? (
                  <DocLink href={libroFamiliaUrl} label={t('alta_doc.ver_documento')} />
                ) : (
                  '—'
                )
              }
            />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-700 inline-flex items-center gap-1 font-medium underline underline-offset-2"
    >
      <FileTextIcon className="size-4" />
      {label}
    </a>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-dashed border-neutral-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-muted-foreground w-48 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
