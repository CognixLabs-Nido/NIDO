'use client'

import { useRef, useState } from 'react'

import { ImagePlusIcon, Loader2Icon } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface Props {
  centroId: string
  locale: string
  /** URL actual del logo (relativa o pública de Storage). */
  initialUrl?: string | null
}

interface RespuestaOk {
  success: true
  logo: { url: string }
}
interface RespuestaError {
  success: false
  error: string
}

/**
 * Subida/sustitución del **logo del centro** (F10-3, ADR-0010). Dirección la usa
 * desde la configuración del centro. El procesado (PNG con transparencia, sin
 * metadatos) y la autorización viven en `/[locale]/centro/logo`; aquí solo el
 * input + preview + estados.
 */
export function SubirLogoCentro({ centroId, locale, initialUrl }: Props) {
  const t = useTranslations('centro.logo')
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
      form.append('centro_id', centroId)
      const res = await fetch(`/${locale}/centro/logo`, { method: 'POST', body: form })
      const data = (await res.json()) as RespuestaOk | RespuestaError
      if (!data.success) {
        toast.error(tRoot(data.error))
        return
      }
      setUrl(data.logo.url)
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
      <div className="bg-muted/40 relative flex h-16 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border p-2">
        {url ? (
          <Image
            src={url}
            alt={t('alt')}
            width={140}
            height={40}
            className="max-h-full w-auto object-contain"
            unoptimized
          />
        ) : (
          <span className="text-muted-foreground text-xs">{t('sin_logo')}</span>
        )}
        {subiendo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2Icon className="size-5 animate-spin text-white" />
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
          accept="image/png,image/jpeg,image/webp"
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
