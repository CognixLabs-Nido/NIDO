import { AlertTriangleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'

import type { DocumentoNino, Resultado } from '../lib/firmar-documentos'
import { DocumentosParaFirmar } from './DocumentosParaFirmar'

/**
 * Los documentos del centro en la ficha del niño (fase 4, 4c): la de la familia y la de Dirección.
 * Fuera del alta se firman aquí, con la misma pieza que en el alta; el modo lo vuelve a decidir el
 * servidor al firmar. Sin nada que le toque al niño (sin matrícula viva, o el centro sin
 * documentos), no sale. Si la lectura falla, se dice.
 */
export async function DocumentosCentroNino({
  locale,
  ninoId,
  lectura,
  modoDireccion,
}: {
  locale: string
  ninoId: string
  lectura: Resultado<DocumentoNino[]>
  modoDireccion: boolean
}) {
  if (lectura.ok && lectura.data.length === 0) return null
  const t = await getTranslations('firmar_documentos')
  return (
    <section id="documentos-centro" className="scroll-mt-4" data-testid="documentos-centro-nino">
      <Card>
        <CardContent>
          {lectura.ok ? (
            <DocumentosParaFirmar
              locale={locale}
              ninoId={ninoId}
              documentos={lectura.data}
              modoDireccion={modoDireccion}
            />
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
              {/* La lectura solo falla de una forma (`leerDocumentosNino`). */}
              {t('errors.leer')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
