'use client'

import { CheckCircle2Icon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import { DocumentosCentroAlta, type DocumentoAltaFila } from './DocumentosCentroAlta'

interface Props {
  locale: string
  ninoId: string
  /** Los documentos del centro que le tocan al niño (fase 4): las normas, entre ellos. */
  documentosCentro: DocumentoAltaFila[]
  /** Modo Dirección del alta: la firma se registra en persona (papel), sin trazo. */
  modoDireccion?: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 2 del alta (G-1) — acuses. (1) **Los documentos del centro** (fase 4): las normas, el
 * presupuesto y los que la admin defina, cada uno con su estado; se firman aquí, y uno que el
 * centro todavía no ha subido no frena el alta (P-6). Desde el 4b-2 (decisiones del 2026-11-06)
 * es el único camino de las normas: ni la autorización de normas ni la casilla. (2) **Privacidad**:
 * ya se aceptó al crear la cuenta (consent obligatorio en `acceptInvitationCore`); aquí solo se
 * deja constancia con enlace al aviso.
 */
export function PasoAcuses({
  locale,
  ninoId,
  documentosCentro,
  modoDireccion = false,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')

  return (
    <div className="space-y-6">
      <DocumentosCentroAlta
        locale={locale}
        ninoId={ninoId}
        documentos={documentosCentro}
        modoDireccion={modoDireccion}
      />

      {/* Privacidad (aceptada al crear la cuenta) */}
      <section className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('acuses.privacidad_titulo')}</h3>
        <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
          <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
          {t('acuses.privacidad_aceptada')}
        </p>
        <Link
          href={`/${locale}/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary text-sm underline"
        >
          {t('acuses.privacidad_ver')}
        </Link>
      </section>

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        <Button type="button" onClick={onNext}>
          {t('wizard.siguiente')}
        </Button>
      </div>
    </div>
  )
}
