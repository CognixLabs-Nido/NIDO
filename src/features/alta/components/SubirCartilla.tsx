'use client'

import { useRef, useState } from 'react'

import { FileCheck2Icon, Loader2Icon, UploadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface Props {
  ninoId: string
  locale: string
  /** Ya hay una cartilla persistida (no se previsualiza: documento sensible). */
  yaSubida: boolean
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
 * (tutor + consentimiento `datos_medicos`) y persiste la ruta vía la RPC médica. No
 * previsualiza el documento (sensible); solo confirma que hay una cartilla.
 */
export function SubirCartilla({ ninoId, locale, yaSubida }: Props) {
  const t = useTranslations('alta')
  const tRoot = useTranslations()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [subida, setSubida] = useState(yaSubida)
  const [subiendo, setSubiendo] = useState(false)

  async function subir(file: File) {
    setSubiendo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('nino_id', ninoId)
      const res = await fetch(`/${locale}/family/cartilla`, { method: 'POST', body: form })
      const data = (await res.json()) as RespuestaOk | RespuestaError
      if (!data.success) {
        toast.error(tRoot(data.error))
        return
      }
      setSubida(true)
      toast.success(t('medico.cartilla_subida'))
      router.refresh()
    } catch {
      toast.error(tRoot('fotos.errors.subida_fallo'))
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-1.5">
      {subida && (
        <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
          <FileCheck2Icon className="size-4" strokeWidth={2} aria-hidden />
          {t('medico.cartilla_ok')}
        </p>
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
