'use client'

import { useRef, useState } from 'react'

import { IdCardIcon, Loader2Icon, Trash2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { AdjuntoFirma, PersonaAutorizadaEdit } from '../types'

interface Props {
  value: PersonaAutorizadaEdit[]
  onChange: (personas: PersonaAutorizadaEdit[]) => void
  disabled?: boolean
  /** Niño firmante: habilita subir la foto del DNI por persona (F10-3). Sin él, oculto. */
  ninoId?: string
}

/**
 * Editor de la lista de personas autorizadas a recoger (recogida, F8-2). Filas
 * nombre + DNI (laxo) + parentesco, y —si se pasa `ninoId`— la **foto del DNI**
 * opcional por persona (F10-3): se sube ANTES de firmar y al firmar se ata al hash.
 * Reutiliza los inputs base; no conoce el flujo de firma (lo orquesta el panel).
 */
export function PersonasAutorizadasEditor({ value, onChange, disabled, ninoId }: Props) {
  const t = useTranslations('autorizaciones')

  function actualizar(i: number, campo: 'nombre' | 'dni' | 'parentesco', v: string) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, [campo]: v } : p)))
  }
  function setAdjunto(i: number, dni_adjunto: AdjuntoFirma | undefined, dni_url: string | null) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, dni_adjunto, dni_url } : p)))
  }
  function anadir() {
    onChange([...value, { nombre: '', dni: '', parentesco: '' }])
  }
  function quitar(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      <Label>{t('recogida.lista')}</Label>
      {value.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('recogida.lista_vacia')}</p>
      )}
      <ul className="space-y-3">
        {value.map((p, i) => (
          <li key={i} className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Input
                value={p.nombre}
                onChange={(e) => actualizar(i, 'nombre', e.target.value)}
                placeholder={t('recogida.nombre')}
                maxLength={200}
                disabled={disabled}
                aria-label={t('recogida.nombre')}
              />
              <Input
                value={p.dni}
                onChange={(e) => actualizar(i, 'dni', e.target.value)}
                placeholder={t('recogida.dni')}
                maxLength={20}
                disabled={disabled}
                aria-label={t('recogida.dni')}
              />
              <Input
                value={p.parentesco ?? ''}
                onChange={(e) => actualizar(i, 'parentesco', e.target.value)}
                placeholder={t('recogida.parentesco')}
                maxLength={100}
                disabled={disabled}
                aria-label={t('recogida.parentesco')}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => quitar(i)}
                disabled={disabled}
                aria-label={t('recogida.quitar')}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
            {ninoId && (
              <SubirDniControl
                ninoId={ninoId}
                currentUrl={p.dni_url ?? null}
                disabled={disabled}
                onUploaded={(adj, url) => setAdjunto(i, adj, url)}
                onRemove={() => setAdjunto(i, undefined, null)}
              />
            )}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={anadir} disabled={disabled}>
        <UserPlusIcon className="mr-1 size-4" />
        {t('recogida.anadir')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('recogida.dni_aviso')}</p>
    </div>
  )
}

interface RespuestaOk {
  success: true
  adjunto: {
    bucket: string
    path: string
    hash: string
    url: string | null
    urlMiniatura: string | null
  }
}
interface RespuestaError {
  success: false
  error: string
}

/** Subida de la foto del DNI de UNA persona (F10-3). Sube antes de firmar. */
function SubirDniControl({
  ninoId,
  currentUrl,
  disabled,
  onUploaded,
  onRemove,
}: {
  ninoId: string
  currentUrl: string | null
  disabled?: boolean
  onUploaded: (adjunto: AdjuntoFirma, url: string | null) => void
  onRemove: () => void
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const locale = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  async function subir(file: File) {
    setSubiendo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('nino_id', ninoId)
      const res = await fetch(`/${locale}/recogida/dni`, { method: 'POST', body: form })
      const data = (await res.json()) as RespuestaOk | RespuestaError
      if (!data.success) {
        toast.error(tRoot(data.error))
        return
      }
      onUploaded(
        { bucket: data.adjunto.bucket, path: data.adjunto.path, hash: data.adjunto.hash },
        data.adjunto.url ?? data.adjunto.urlMiniatura
      )
    } catch {
      toast.error(t('recogida.dni_foto_fallo'))
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (currentUrl) {
    return (
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado (cross-origin, caduca) */}
        <img
          src={currentUrl}
          alt={t('recogida.dni_foto')}
          className="h-10 w-16 rounded border object-cover"
        />
        <span className="text-success-700 text-xs">{t('recogida.dni_foto_ok')}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled || subiendo}
        >
          <XIcon className="mr-1 size-3.5" />
          {t('recogida.dni_foto_quitar')}
        </Button>
      </div>
    )
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || subiendo}
        onClick={() => inputRef.current?.click()}
        aria-busy={subiendo}
      >
        {subiendo ? (
          <Loader2Icon className="mr-1 size-4 animate-spin" />
        ) : (
          <IdCardIcon className="mr-1 size-4" />
        )}
        {t('recogida.dni_foto_subir')}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif"
        className="hidden"
        disabled={disabled || subiendo}
        onChange={(ev) => {
          const f = ev.target.files?.[0]
          if (f) void subir(f)
        }}
      />
    </div>
  )
}
