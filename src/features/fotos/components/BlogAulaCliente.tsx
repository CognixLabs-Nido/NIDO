'use client'

import { ImagePlusIcon, Loader2Icon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/shared/components/EmptyState'

import { etiquetarNino, desetiquetarNino } from '../actions/etiquetar'
import {
  crearPublicacion,
  editarPublicacion,
  eliminarMedia,
  eliminarPublicacion,
} from '../actions/gestionar-publicacion'
import { esHeicBytes } from '../lib/es-heic'
import { MAX_BYTES_FOTO, MAX_FOTOS_PUBLICACION, MAX_TEXTO_PUBLICACION } from '../types'
import type { MediaItem, NinoAulaFoto, PublicacionItem } from '../types'

interface Props {
  locale: string
  aulaId: string
  ninos: NinoAulaFoto[]
  puedePublicar: boolean
  publicaciones: PublicacionItem[]
}

interface EditorState {
  id: string
  isNew: boolean
  texto: string
  media: MediaItem[]
}

export function BlogAulaCliente({ locale, aulaId, ninos, puedePublicar, publicaciones }: Props) {
  const t = useTranslations('fotos')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const etiquetables = ninos.filter((n) => n.puedeAparecer)
  const nombrePorNino = new Map(ninos.map((n) => [n.id, `${n.nombre} ${n.apellidos}`.trim()]))

  function abrirNueva() {
    startTransition(async () => {
      const r = await crearPublicacion({ aula_id: aulaId })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setEditor({ id: r.data.publicacion_id, isNew: true, texto: '', media: [] })
    })
  }

  function abrirEditar(pub: PublicacionItem) {
    setEditor({ id: pub.id, isNew: false, texto: pub.texto ?? '', media: pub.media })
  }

  async function subirArchivos(files: FileList) {
    if (!editor) return
    const restantes = MAX_FOTOS_PUBLICACION - editor.media.length
    if (restantes <= 0) {
      toast.error(t('validation.max_fotos'))
      return
    }
    const seleccion = Array.from(files).slice(0, restantes)
    setSubiendo(true)
    for (const file of seleccion) {
      // HEIC no soportado (no se decodifica ni en cliente ni en servidor) — aviso claro
      // antes de subir. El servidor también lo rechaza como defensa.
      const cabecera = new Uint8Array(await file.slice(0, 12).arrayBuffer())
      if (esHeicBytes(cabecera)) {
        toast.error(t('validation.heic_no_soportado'))
        continue
      }
      // Tope de 4 MB sobre el archivo subido (margen bajo el límite de ~4,5 MB del body de Vercel).
      if (file.size > MAX_BYTES_FOTO) {
        toast.error(t('validation.tamano_max'))
        continue
      }
      const form = new FormData()
      form.append('publicacion_id', editor.id)
      form.append('file', file)
      try {
        const res = await fetch(`/${locale}/fotos/upload`, { method: 'POST', body: form })
        const json = (await res.json()) as
          | { success: true; media: MediaItem & { etiquetas?: string[] } }
          | { success: false; error: string }
        if (!json.success) {
          toast.error(tErrors(json.error))
          continue
        }
        const nueva: MediaItem = { ...json.media, etiquetas: [] }
        setEditor((prev) => (prev ? { ...prev, media: [...prev.media, nueva] } : prev))
      } catch {
        toast.error(t('errors.subida_fallo'))
      }
    }
    setSubiendo(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function alternarEtiqueta(mediaId: string, ninoId: string, marcar: boolean) {
    // Optimista: refleja el cambio y revierte si la acción falla.
    setEditor((prev) =>
      prev
        ? {
            ...prev,
            media: prev.media.map((m) =>
              m.id === mediaId
                ? {
                    ...m,
                    etiquetas: marcar
                      ? [...m.etiquetas, ninoId]
                      : m.etiquetas.filter((x) => x !== ninoId),
                  }
                : m
            ),
          }
        : prev
    )
    startTransition(async () => {
      const r = marcar
        ? await etiquetarNino({ media_id: mediaId, nino_id: ninoId })
        : await desetiquetarNino({ media_id: mediaId, nino_id: ninoId })
      if (!r.success) {
        toast.error(tErrors(r.error))
        setEditor((prev) =>
          prev
            ? {
                ...prev,
                media: prev.media.map((m) =>
                  m.id === mediaId
                    ? {
                        ...m,
                        etiquetas: marcar
                          ? m.etiquetas.filter((x) => x !== ninoId)
                          : [...m.etiquetas, ninoId],
                      }
                    : m
                ),
              }
            : prev
        )
      }
    })
  }

  function quitarFoto(mediaId: string) {
    startTransition(async () => {
      const r = await eliminarMedia({ media_id: mediaId })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setEditor((prev) =>
        prev ? { ...prev, media: prev.media.filter((m) => m.id !== mediaId) } : prev
      )
    })
  }

  function guardar() {
    if (!editor) return
    startTransition(async () => {
      const r = await editarPublicacion({ publicacion_id: editor.id, texto: editor.texto })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      toast.success(t('composer.publicada'))
      setEditor(null)
      router.refresh()
    })
  }

  function cerrarEditor() {
    if (!editor) return
    const e = editor
    // Limpia un borrador nuevo y vacío (sin fotos ni texto) para no dejar posts huérfanos.
    if (e.isNew && e.media.length === 0 && e.texto.trim() === '') {
      startTransition(async () => {
        await eliminarPublicacion({ publicacion_id: e.id })
        setEditor(null)
        router.refresh()
      })
      return
    }
    setEditor(null)
    router.refresh()
  }

  function borrarPublicacion(id: string) {
    startTransition(async () => {
      const r = await eliminarPublicacion({ publicacion_id: id })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      toast.success(t('lista.borrada'))
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {puedePublicar && (
        <div className="flex justify-end">
          <Button onClick={abrirNueva} disabled={pending}>
            <ImagePlusIcon className="size-4" />
            {t('composer.nueva')}
          </Button>
        </div>
      )}

      {publicaciones.length === 0 ? (
        <EmptyState icon={<ImagePlusIcon strokeWidth={1.75} />} title={t('lista.vacia')} />
      ) : (
        <ul className="space-y-5">
          {publicaciones.map((pub) => (
            <li key={pub.id} className="bg-card border-border/60 space-y-3 rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {pub.texto && <p className="text-foreground text-sm break-words">{pub.texto}</p>}
                  <p className="text-muted-foreground text-xs">
                    {pub.autorNombre ?? ''} · {formatearFecha(pub.createdAt, locale)}
                  </p>
                </div>
                {pub.puedeGestionar && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => abrirEditar(pub)}
                      disabled={pending}
                      aria-label={t('lista.editar')}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => borrarPublicacion(pub.id)}
                      disabled={pending}
                      aria-label={t('lista.borrar')}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {pub.media.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {pub.media.map((m) => (
                    <FotoMiniatura
                      key={m.id}
                      media={m}
                      alt={pub.texto ?? t('foto_alt')}
                      etiquetasLabel={etiquetasTexto(m, nombrePorNino)}
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editor !== null} onOpenChange={(o) => !o && cerrarEditor()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editor?.isNew ? t('composer.titulo') : t('composer.editar')}</DialogTitle>
          </DialogHeader>

          {editor && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fotos-texto">{t('composer.texto_label')}</Label>
                <Textarea
                  id="fotos-texto"
                  rows={3}
                  maxLength={MAX_TEXTO_PUBLICACION}
                  value={editor.texto}
                  placeholder={t('composer.texto_placeholder')}
                  onChange={(ev) =>
                    setEditor((prev) => (prev ? { ...prev, texto: ev.target.value } : prev))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="fotos-files">{t('composer.fotos_label')}</Label>
                  <span className="text-muted-foreground text-xs">
                    {editor.media.length}/{MAX_FOTOS_PUBLICACION}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  id="fotos-files"
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/heif"
                  multiple
                  disabled={subiendo || editor.media.length >= MAX_FOTOS_PUBLICACION}
                  onChange={(ev) => ev.target.files && subirArchivos(ev.target.files)}
                  className="file:bg-muted text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm"
                  aria-busy={subiendo}
                />
                {subiendo && (
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    {t('composer.procesando')}
                  </p>
                )}
              </div>

              {editor.media.length > 0 && (
                <ul className="space-y-3">
                  {editor.media.map((m) => (
                    <li key={m.id} className="border-border/60 space-y-2 rounded-xl border p-2">
                      <div className="flex gap-3">
                        <div className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage; next/image no aporta aquí */}
                          <img
                            src={m.urlMiniatura ?? m.url ?? ''}
                            alt={t('foto_alt')}
                            className="size-20 rounded-lg object-cover"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="absolute -top-2 -right-2 size-6 rounded-full p-0"
                            onClick={() => quitarFoto(m.id)}
                            disabled={pending}
                            aria-label={t('composer.quitar_foto')}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                        <fieldset className="min-w-0 flex-1">
                          <legend className="text-muted-foreground mb-1 text-xs font-medium">
                            {t('etiquetar.titulo')}
                          </legend>
                          {etiquetables.length === 0 ? (
                            <p className="text-muted-foreground text-xs">
                              {t('etiquetar.sin_ninos')}
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                              {etiquetables.map((n) => {
                                const marcado = m.etiquetas.includes(n.id)
                                return (
                                  <label key={n.id} className="flex items-center gap-1.5 text-sm">
                                    <Checkbox
                                      checked={marcado}
                                      onCheckedChange={(c) =>
                                        alternarEtiqueta(m.id, n.id, c === true)
                                      }
                                    />
                                    {n.nombre}
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </fieldset>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrarEditor} disabled={pending}>
              {t('composer.cerrar')}
            </Button>
            <Button type="button" onClick={guardar} disabled={pending || subiendo}>
              {t('composer.publicar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FotoMiniatura({
  media,
  alt,
  etiquetasLabel,
}: {
  media: MediaItem
  alt: string
  etiquetasLabel: string | null
}) {
  return (
    <a
      href={media.url ?? media.urlMiniatura ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage; next/image no aporta aquí */}
      <img
        src={media.urlMiniatura ?? media.url ?? ''}
        alt={alt}
        className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
      />
      {etiquetasLabel && (
        <Badge
          variant="warm"
          className="absolute bottom-1 left-1 max-w-[90%] truncate text-[0.65rem]"
        >
          {etiquetasLabel}
        </Badge>
      )}
    </a>
  )
}

function etiquetasTexto(media: MediaItem, nombres: Map<string, string>): string | null {
  if (media.etiquetas.length === 0) return null
  return media.etiquetas.map((id) => nombres.get(id) ?? '·').join(', ')
}

function formatearFecha(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso)
    )
  } catch {
    return iso
  }
}
