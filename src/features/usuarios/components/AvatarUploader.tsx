'use client'

import { ImagePlusIcon, Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { subirAvatar } from '@/features/usuarios/lib/subir-avatar'
import { safeTranslateError } from '@/shared/lib/safe-translate'

interface Props {
  locale: string
  usuarioId: string
  /** URL firmada inicial del avatar (null = aún sin foto → muestra iniciales). */
  initialUrl: string | null
  /** Inicial(es) para el fallback cuando no hay foto. */
  initials: string
}

/**
 * Subida/cambio del avatar del propio usuario (F11-C-3). Sube por la route handler
 * (multipart) y refresca la vista previa con la URL firmada que devuelve. Foto
 * OPCIONAL (decisión D): sin foto se muestran las iniciales. Mismo patrón de UI que
 * `SubirFotoNino` (F10-3): `<img>` con enlace firmado (no `next/image`).
 */
export function AvatarUploader({ locale, usuarioId, initialUrl, initials }: Props) {
  const t = useTranslations('auth.avatar')
  const tRoot = useTranslations()
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite reseleccionar el mismo archivo
    if (!file) return
    startTransition(async () => {
      const r = await subirAvatar(locale, usuarioId, file)
      if (!r.ok) {
        toast.error(safeTranslateError(tRoot, r.error))
        return
      }
      setUrl(r.url)
      toast.success(t('actualizada'))
    })
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-primary-100 text-primary-700 relative flex size-16 items-center justify-center overflow-hidden rounded-full text-2xl font-bold">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- enlace firmado (cross-origin, caduca)
          <img src={url} alt={t('alt')} className="size-full object-cover" />
        ) : (
          initials
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2Icon className="size-5 animate-spin text-white" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={onSelect}
        disabled={pending}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlusIcon className="mr-1 size-4" />
        {url ? t('cambiar') : t('subir')}
      </Button>
    </div>
  )
}
