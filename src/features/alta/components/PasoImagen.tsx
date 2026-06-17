'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { crearImagenAutorizacion } from '@/features/autorizaciones/actions/crear-imagen'
import { FirmarAutorizacionPanel } from '@/features/autorizaciones/components/FirmarAutorizacionPanel'
import { SubirFotoNino } from '@/features/ninos/components/SubirFotoNino'

import type { ImagenPanelData } from '../lib/tipos'

interface Props {
  ninoId: string
  locale: string
  ninoNombre: string
  /** Panel pre-computado por la ruta si YA existe la instancia de imagen. */
  panel: ImagenPanelData | null
  /** El centro no tiene plantilla de imagen publicada → el paso se omite. */
  sinPlantilla: boolean
  fotoInicialUrl: string | null
  currentUserId: string
  currentUserNombre: string
  onBack: () => void
  onFinalizar: () => void
}

/**
 * Paso 5 — autorización de imagen + foto del niño. La imagen se instancia **lazy**: si
 * la ruta no encontró instancia (panel null) y hay plantilla, un botón llama a
 * `crearImagenAutorizacion` (la action, que sí puede revalidar) y `router.refresh()`
 * re-ejecuta la ruta para poblar el panel. La firma usa `FirmarAutorizacionPanel`
 * (al firmar, el trigger sincroniza el consentimiento de imagen + `puede_aparecer_en_fotos`).
 * Edge `sin_plantilla` → el paso se omite. Cierra con "Finalizar".
 */
export function PasoImagen({
  ninoId,
  locale,
  ninoNombre,
  panel,
  sinPlantilla,
  fotoInicialUrl,
  currentUserId,
  currentUserNombre,
  onBack,
  onFinalizar,
}: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [omitido, setOmitido] = useState(false)

  function instanciar() {
    startTransition(async () => {
      const r = await crearImagenAutorizacion({ nino_id: ninoId })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      if (r.data.estado === 'sin_plantilla') {
        setOmitido(true)
        return
      }
      // 'lista' → la ruta re-leerá la instancia y poblará el panel.
      router.refresh()
    })
  }

  const omitir = sinPlantilla || omitido

  return (
    <div className="space-y-6">
      {/* Autorización de imagen */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('imagen.autorizacion_titulo')}</h3>
        {omitir ? (
          <p className="text-muted-foreground text-sm">{t('imagen.sin_plantilla')}</p>
        ) : panel ? (
          <FirmarAutorizacionPanel
            autorizacionId={panel.autorizacionId}
            tipo="autorizacion_imagenes"
            firmable={panel.firmable}
            roster={panel.roster}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">{t('imagen.cargar_ayuda')}</p>
            <Button type="button" onClick={instanciar} disabled={pending}>
              {pending ? t('wizard.guardando') : t('imagen.cargar')}
            </Button>
          </div>
        )}
      </section>

      {/* Foto del niño */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('imagen.foto_titulo')}</h3>
        <SubirFotoNino
          ninoId={ninoId}
          locale={locale}
          initialUrl={fotoInicialUrl}
          alt={ninoNombre}
        />
      </section>

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        <Button type="button" onClick={onFinalizar}>
          {t('wizard.finalizar')}
        </Button>
      </div>
    </div>
  )
}
