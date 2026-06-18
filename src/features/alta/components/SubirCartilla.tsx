'use client'

import { useRef, useState } from 'react'

import { ExternalLinkIcon, FileCheck2Icon, Loader2Icon, UploadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface Props {
  ninoId: string
  locale: string
  /** Ya hay una cartilla persistida (verdad del servidor). */
  yaSubida: boolean
  /** Enlace firmado para ABRIR la cartilla y verificar el documento; null si no hay. */
  cartillaUrl: string | null
}

interface RespuestaOk {
  success: true
  cartilla: { path: string; url: string | null; urlMiniatura: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

/**
 * Subida de la cartilla de vacunas (Pieza 3b-2b). Posta a la ruta de 3b-1
 * (`/{locale}/family/cartilla`), que sube al bucket privado bajo la RLS de storage
 * (tutor + consentimiento `datos_medicos`) y persiste la ruta vía la RPC médica.
 *
 * El indicador "✓ guardada" se deriva de la **verdad del servidor** (`yaSubida`) o de
 * un éxito local optimista (`subidaLocal`) — NUNCA solo del estado local: así un
 * re-mount del paso (el wizard monta/desmonta cada paso) o una respuesta perdida pero
 * persistida no borran el ✓. Tras CADA intento (éxito o `catch`) se dispara
 * `router.refresh()` para re-derivar `yaSubida` del servidor al instante; si la subida
 * sí cuajó (respuesta perdida en serverless frío), el ✓ aparece tras el intento sin
 * dejar un toast de error contradictorio.
 */
export function SubirCartilla({ ninoId, locale, yaSubida, cartillaUrl }: Props) {
  const t = useTranslations('alta')
  const tRoot = useTranslations()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [subidaLocal, setSubidaLocal] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  // Verdad del servidor OR éxito optimista local. Reactivo al prop `yaSubida`.
  const subida = yaSubida || subidaLocal

  async function subir(file: File) {
    setSubiendo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('nino_id', ninoId)
      const res = await fetch(`/${locale}/family/cartilla`, { method: 'POST', body: form })
      const data = (await res.json()) as RespuestaOk | RespuestaError
      if (!data.success) {
        // Error explícito del servidor (p. ej. sin consentimiento): la ruta ya hizo
        // rollback del objeto, no queda huérfano. Mostramos el motivo.
        toast.error(tRoot(data.error))
        return
      }
      setSubidaLocal(true)
      toast.success(t('medico.cartilla_subida'))
    } catch {
      // Respuesta perdida (timeout / cold start): puede haberse persistido igualmente.
      // NO mostramos error aquí; el `router.refresh()` del finally re-deriva la verdad
      // del servidor y, si consta subida, el ✓ aparece sin toast contradictorio.
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    }
  }

  return (
    <div className="space-y-1.5">
      {subida && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
            <FileCheck2Icon className="size-4" strokeWidth={2} aria-hidden />
            {t('medico.cartilla_ok')}
          </p>
          {cartillaUrl && (
            <a
              href={cartillaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              <ExternalLinkIcon className="size-3.5" aria-hidden />
              {t('medico.cartilla_ver')}
            </a>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
        aria-busy={subiendo}
      >
        {subiendo ? (
          <Loader2Icon className="mr-1 size-4 animate-spin" />
        ) : (
          <UploadIcon className="mr-1 size-4" />
        )}
        {subida ? t('medico.cartilla_cambiar') : t('medico.cartilla_subir')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('medico.cartilla_ayuda')}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif"
        className="hidden"
        disabled={subiendo}
        onChange={(ev) => {
          const f = ev.target.files?.[0]
          if (f) void subir(f)
        }}
      />
    </div>
  )
}
