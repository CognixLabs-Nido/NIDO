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
export function RespuestaImagenAlta({ ninoId, respuestaInicial, onRespondido }: Props) {
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
      <p className="text-muted-foreground text-xs">{t('acuses.imagen_libre')}</p>
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
        {respuesta !== 'no' && (
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

/** Un tutor legal del niño con cuenta, con su respuesta, para el alta en papel. */
export interface TutorImagenPapel {
  usuarioId: string
  nombre: string
  respuesta: RespuestaImagen
}

/**
 * La pregunta de la imagen en el alta en papel (fase 10b-2). Dirección anota, por cada tutor legal,
 * lo que contestó en el papel: «sí» o «no», a su nombre y no al de quien lo teclea (decisión del
 * responsable del 2026-11-18: «No es un «no» de la directora: es el de la familia, anotado por
 * ella»). Sin ningún tutor legal con cuenta todavía no se puede anotar nada, y se dice: falta que
 * acepte la invitación.
 */
export function RespuestaImagenPapel({
  ninoId,
  tutores,
  onRespondido,
}: {
  ninoId: string
  /** `null`: no se pudieron leer los tutores. */
  tutores: TutorImagenPapel[] | null
  onRespondido?: () => void
}) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaImagen>>(() =>
    Object.fromEntries((tutores ?? []).map((x) => [x.usuarioId, x.respuesta]))
  )
  const [pending, startTransition] = useTransition()

  function responder(tutorId: string, si: boolean) {
    if (pending) return
    startTransition(async () => {
      const r = si
        ? await otorgarConsentimientoImagenAlta({ nino_id: ninoId, tutor_id: tutorId })
        : await denegarConsentimientoImagenAlta({ nino_id: ninoId, tutor_id: tutorId })
      if (r.success) {
        setRespuestas((prev) => ({ ...prev, [tutorId]: si ? 'si' : 'no' }))
        onRespondido?.()
        toast.success(t('acuses.aceptado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-2" data-testid="alta-imagen-papel">
      <p className="text-sm">{t('acuses.imagen_pregunta')}</p>
      <p className="text-muted-foreground text-xs">{t('acuses.imagen_papel_ayuda')}</p>
      {tutores === null ? (
        <p className="text-sm">{t('acuses.imagen_papel_no_se_pudo_leer')}</p>
      ) : tutores.length === 0 ? (
        <p
          role="note"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm"
          data-testid="alta-imagen-papel-sin-cuenta"
        >
          {t('acuses.imagen_papel_sin_cuenta')}
        </p>
      ) : (
        <ul className="space-y-2">
          {tutores.map((tutor) => {
            const respuesta = respuestas[tutor.usuarioId] ?? null
            return (
              <li
                key={tutor.usuarioId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
                data-testid={`alta-imagen-papel-${tutor.usuarioId}`}
              >
                <span className="text-sm">
                  {tutor.nombre} ·{' '}
                  {respuesta === 'si'
                    ? t('acuses.imagen_aceptado')
                    : respuesta === 'no'
                      ? t('acuses.imagen_denegado')
                      : t('acuses.imagen_papel_sin_respuesta')}
                </span>
                <span className="flex gap-2">
                  {respuesta !== 'si' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => responder(tutor.usuarioId, true)}
                    >
                      {t('acuses.imagen_boton_si')}
                    </Button>
                  )}
                  {respuesta !== 'no' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => responder(tutor.usuarioId, false)}
                    >
                      {t('acuses.imagen_boton_no')}
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
