'use client'

import { useState } from 'react'

import { Loader2Icon, UploadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { CursoDeLaPantalla } from '../lib/pantalla'

interface Props {
  locale: string
  centroId: string
  documentoId: string
  deCurso: boolean
  /** Los cursos `planificado` o `activo` del centro (nunca `cerrado`). */
  cursos: CursoDeLaPantalla[]
  /**
   * Por curso (`''` sin curso), cuántos niños firmaron una versión anterior (4d). Un curso sin
   * versión no está: no hay nada que volver a firmar, y no se ofrece pedirlo.
   */
  anteriores: Record<string, number>
}

type Respuesta = { success: true } | { success: false; error: string }

/** Tope en el navegador, el mismo que la app y el bucket (10 MB). */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Sube una versión de un documento (3c), por la ruta del 3a, que calcula el hash y registra. En un
 * documento de curso se elige el curso; en otro no se pregunta. Una versión nueva no pide que vuelvan
 * a firmar (J4) salvo que la admin lo pida (4d), y solo se le ofrece si ese documento y ese curso ya
 * tienen una versión.
 */
export function SubirVersionDialog({
  locale,
  centroId,
  documentoId,
  deCurso,
  cursos,
  anteriores,
}: Props) {
  const t = useTranslations('documentos_centro.pantalla')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fichero, setFichero] = useState<File | null>(null)
  const [cursoId, setCursoId] = useState<string>('')
  const [subiendo, setSubiendo] = useState(false)
  const [pideRefirma, setPideRefirma] = useState(false)
  const items = cursos.map((c) => ({ value: c.id, label: c.nombre }))
  const sinCurso = deCurso && cursos.length === 0
  const anterior: number | undefined = anteriores[deCurso ? cursoId : '']

  function abrir(o: boolean) {
    if (o) {
      setFichero(null)
      setPideRefirma(false)
      setCursoId(cursos.find((c) => c.estado === 'activo')?.id ?? cursos[0]?.id ?? '')
    }
    setOpen(o)
  }

  async function subir(ev: React.FormEvent) {
    ev.preventDefault()
    if (!fichero) return
    if (fichero.size > MAX_BYTES) {
      toast.error(tRoot('documentos_centro.errors.tamano'))
      return
    }
    if (deCurso && !cursoId) {
      toast.error(tRoot('documentos_centro.errors.falta_curso'))
      return
    }
    setSubiendo(true)
    try {
      const form = new FormData()
      form.append('file', fichero)
      form.append('centro_id', centroId)
      form.append('documento_id', documentoId)
      form.append('curso_academico_id', deCurso ? cursoId : '')
      form.append('pide_refirma', anterior !== undefined && pideRefirma ? 'true' : 'false')
      const res = await fetch(`/${locale}/admin/documentos-centro/version`, {
        method: 'POST',
        body: form,
      })
      const data = (await res.json()) as Respuesta
      if (!data.success) {
        toast.error(tRoot(data.error))
        return
      }
      toast.success(t('subida_ok'))
      setOpen(false)
      router.refresh()
    } catch {
      toast.error(tRoot('documentos_centro.errors.subida'))
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <Button size="sm">
            <UploadIcon className="mr-1 size-4" />
            {t('subir')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('subir_titulo')}</DialogTitle>
          <DialogDescription>{t('subir_no_pide_refirma')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={subir} className="space-y-4">
          {deCurso && (
            <div className="space-y-1.5">
              <Label>{t('campos.curso')}</Label>
              {sinCurso ? (
                <p className="text-muted-foreground text-sm">{t('sin_cursos')}</p>
              ) : (
                <Select
                  items={items}
                  value={cursoId || undefined}
                  onValueChange={(v) => {
                    setCursoId(v as string)
                    setPideRefirma(false)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="version-fichero">{t('campos.fichero')}</Label>
            <input
              id="version-fichero"
              type="file"
              accept="application/pdf"
              className="text-sm"
              disabled={subiendo}
              onChange={(e) => setFichero(e.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground text-xs">{t('fichero_ayuda')}</p>
          </div>
          {anterior !== undefined && (
            <div className="space-y-1.5 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={pideRefirma}
                  disabled={subiendo}
                  onChange={(e) => setPideRefirma(e.target.checked)}
                />
                {t('pedir_refirma')}
              </label>
              <p className="text-muted-foreground text-xs" data-testid="pedir-refirma-ayuda">
                {t('pedir_refirma_ayuda', { n: anterior })}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button type="submit" disabled={subiendo || !fichero || sinCurso} aria-busy={subiendo}>
              {subiendo && <Loader2Icon className="mr-1 size-4 animate-spin" />}
              {t('subir')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
