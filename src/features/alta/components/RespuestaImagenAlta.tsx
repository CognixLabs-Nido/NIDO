'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon, CircleSlashIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { denegarConsentimientoImagenAlta } from '../actions/denegar-imagen-alta'
import { otorgarConsentimientoImagenAlta } from '../actions/otorgar-imagen-alta'
import type { RespuestaImagen } from '../lib/respuesta-imagen'

interface Props {
  ninoId: string
  /** La respuesta de quien hace el alta, leída en el servidor (`leerRespuestaImagen`). */
  respuestaInicial: RespuestaImagen
  /**
   * Solo el «sí» (el alta en papel, Dirección): el «no» espera a decidir a qué tutor se atribuye,
   * así que en ese modo se ofrece lo de antes.
   */
  soloSi?: boolean
  /** Aviso al padre tras contestar: la foto del niño depende de la respuesta (refresca la ruta). */
  onRespondido?: () => void
}

/**
 * La pregunta de la imagen del paso `menor` (fase 10, 10a-2). Antes era una casilla que solo
 * otorgaba, y el cierre exigía el «sí»: una familia que no quería fotos tenía que aceptar para
 * matricular. Decisión del responsable del 2026-11-17: «la base exige una RESPUESTA, no un «sí»» (art.
 * 7.4). Dos respuestas, cada una por su función (`otorgar_` y `denegar_consentimiento_imagen`), y se
 * puede cambiar: el «sí» retira el propio «no» y el «no», el propio «sí».
 */
export function RespuestaImagenAlta({
  ninoId,
  respuestaInicial,
  soloSi = false,
  onRespondido,
}: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [respuesta, setRespuesta] = useState<RespuestaImagen>(respuestaInicial)
  const [pending, startTransition] = useTransition()

  function responder(si: boolean) {
    if (pending) return
    startTransition(async () => {
      const r = si
        ? await otorgarConsentimientoImagenAlta({ nino_id: ninoId })
        : await denegarConsentimientoImagenAlta({ nino_id: ninoId })
      if (r.success) {
        setRespuesta(si ? 'si' : 'no')
        onRespondido?.()
        toast.success(t('acuses.aceptado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-2" data-testid="alta-imagen-respuesta">
      <p className="text-sm">{t('acuses.imagen_pregunta')}</p>
      {!soloSi && <p className="text-muted-foreground text-xs">{t('acuses.imagen_libre')}</p>}
      {respuesta === 'si' && (
        <p
          className="text-success-700 flex items-center gap-2 text-sm font-medium"
          data-testid="alta-imagen-si"
        >
          <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
          {t('acuses.imagen_aceptado')}
        </p>
      )}
      {respuesta === 'no' && (
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="alta-imagen-no">
          <CircleSlashIcon className="size-4" strokeWidth={2} aria-hidden />
          {t('acuses.imagen_denegado')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {respuesta !== 'si' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => responder(true)}
            data-testid="alta-imagen-autorizo"
          >
            {t('acuses.imagen_boton_si')}
          </Button>
        )}
        {!soloSi && respuesta !== 'no' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => responder(false)}
            data-testid="alta-imagen-no-autorizo"
          >
            {t('acuses.imagen_boton_no')}
          </Button>
        )}
      </div>
    </div>
  )
}
