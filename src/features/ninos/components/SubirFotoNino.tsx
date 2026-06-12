'use client'

import { useRef, useState } from 'react'

import { ImagePlusIcon, Loader2Icon, UserIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface Props {
  ninoId: string
  locale: string
  /** Enlace firmado (~1 h) de la foto actual; null si aún no hay. */
  initialUrl?: string | null
  /** Texto alternativo (nombre del niño). */
  alt: string
}

interface RespuestaOk {
  success: true
  foto: { path: string; url: string | null; urlMiniatura: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

/**
 * Foto del niño (F10-3): muestra la foto actual (enlace firmado) y permite
 * subir/sustituirla. La sube el **tutor** (su hijo) o **dirección**. El procesado
 * (EXIF fuera, JPEG, sin HEIC) y la autorización viven en el route handler
 * `/[locale]/ninos/[id]/foto`; aquí solo el input + preview + estados.
 */
export function SubirFotoNino({ ninoId, locale, initialUrl, alt }: Props) {
  const t = useTranslations('fotos.nino')
  const tRoot = useTranslations()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(initialUrl ?? null)
  const [subiendo, setSubiendo] = useState(false)

  async function subir(file: File) {
    setSubiendo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/${locale}/ninos/${ninoId}/foto`, { method: 'POST', body: form })
      const data = (await res.json()) as RespuestaOk | RespuestaError
      if (!data.success) {
        toast.error(tRoot(data.error))
        return
      }
      setUrl(data.foto.url ?? data.foto.urlMiniatura)
      toast.success(t('subida_ok'))
      router.refresh()
    } catch {
      toast.error(t('subida_fallo'))
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="bg-muted relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- enlace firmado (cross-origin, caduca)
          <img src={url} alt={alt} className="size-full object-cover" />
        ) : (
          <UserIcon className="text-muted-foreground size-10" strokeWidth={1.5} />
        )}
        {subiendo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2Icon className="size-6 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={subiendo}
          onClick={() => inputRef.current?.click()}
          aria-busy={subiendo}
        >
          <ImagePlusIcon className="mr-1 size-4" />
          {url ? t('cambiar') : t('subir')}
        </Button>
        <p className="text-muted-foreground text-xs">{t('ayuda')}</p>
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
    </div>
  )
}
