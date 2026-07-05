'use client'

import { CheckCircle2Icon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { FirmarAutorizacionPanel } from '@/features/autorizaciones/components/FirmarAutorizacionPanel'

import type { FirmaPanelData } from '../lib/tipos'

interface Props {
  locale: string
  /** Panel de firma de las normas (reglas_regimen_interno), pre-computado por la ruta. */
  normasPanel: FirmaPanelData | null
  /** No hay instancia de normas publicada aplicable al niño → el acuse se omite. */
  normasSinPlantilla: boolean
  currentUserId: string
  currentUserNombre: string
  /** PR-3b-2 · B2: firma PRESENCIAL de las normas cuando lo rellena la Dirección (papel). */
  modoDireccion?: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 2 del alta (G-1) — acuses. (1) **Normas del centro**: firma de la autorización
 * `reglas_regimen_interno` reusando `FirmarAutorizacionPanel` (patrón F8: trazo + hash +
 * versión). La instancia la publica la dirección; aquí la familia la firma. Si el centro
 * no la tiene publicada, el acuse se omite (no bloquea). (2) **Privacidad**: ya se aceptó
 * al crear la cuenta (consent obligatorio en `acceptInvitationCore`); aquí solo se deja
 * constancia con enlace al aviso.
 */
export function PasoAcuses({
  locale,
  normasPanel,
  normasSinPlantilla,
  currentUserId,
  currentUserNombre,
  modoDireccion = false,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')

  return (
    <div className="space-y-6">
      {/* Normas de régimen interno */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('acuses.normas_titulo')}</h3>
        {normasSinPlantilla || !normasPanel ? (
          <p className="text-muted-foreground text-sm">{t('acuses.normas_sin_plantilla')}</p>
        ) : (
          <FirmarAutorizacionPanel
            autorizacionId={normasPanel.autorizacionId}
            tipo="reglas_regimen_interno"
            firmable={normasPanel.firmable}
            roster={normasPanel.roster}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            presencial={modoDireccion}
          />
        )}
      </section>

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
