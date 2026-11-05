'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { crearDocumentoAccion, editarDocumentoAccion } from '../actions/documentos'
import { formularioDocumentoSchema, type FormularioDocumento } from '../schemas/documento'

interface Props {
  centroId: string
  /** Sin documento, crea uno; con él, lo edita. */
  documento?: FormularioDocumento & { id: string }
  /** «De curso» solo cambia sin versiones (J6). Al crear, siempre. */
  puedeCambiarDeCurso: boolean
}

const VACIO: FormularioDocumento = { titulo: '', deCurso: false, obligatorio: true, orden: 0 }

/**
 * Crear o editar un documento del centro (1c): título (J7), de curso (J2), obligatorio y orden.
 * Con versiones, «de curso» se enseña pero no se puede cambiar (J6); la base lo vuelve a mirar.
 */
export function DocumentoDialog({ centroId, documento, puedeCambiarDeCurso }: Props) {
  const t = useTranslations('documentos_centro.pantalla')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [valores, setValores] = useState<FormularioDocumento>(documento ?? VACIO)
  const editando = documento !== undefined

  function abrir(o: boolean) {
    if (o) setValores(documento ?? VACIO)
    setOpen(o)
  }

  function guardar(ev: React.FormEvent) {
    ev.preventDefault()
    const p = formularioDocumentoSchema.safeParse(valores)
    if (!p.success) {
      toast.error(tRoot('documentos_centro.errors.invalido'))
      return
    }
    startTransition(async () => {
      const r = editando
        ? await editarDocumentoAccion({
            documentoId: documento.id,
            titulo: p.data.titulo,
            obligatorio: p.data.obligatorio,
            orden: p.data.orden,
            // Solo se manda si se puede cambiar: con versiones no se toca (J6).
            ...(puedeCambiarDeCurso ? { deCurso: p.data.deCurso } : {}),
          })
        : await crearDocumentoAccion({ centroId, ...p.data })
      if (!r.success) {
        toast.error(tRoot(r.error))
        return
      }
      toast.success(t(editando ? 'guardado' : 'creado'))
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <Button variant={editando ? 'outline' : 'default'} size={editando ? 'sm' : 'default'}>
            {t(editando ? 'editar' : 'nuevo')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t(editando ? 'editar_titulo' : 'nuevo_titulo')}</DialogTitle>
          <DialogDescription>{t('titulo_un_idioma')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={guardar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-titulo">{t('campos.titulo')}</Label>
            <Input
              id="doc-titulo"
              value={valores.titulo}
              maxLength={200}
              onChange={(e) => setValores({ ...valores, titulo: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-orden">{t('campos.orden')}</Label>
            <Input
              id="doc-orden"
              type="number"
              min={0}
              max={1000}
              value={valores.orden}
              onChange={(e) => setValores({ ...valores, orden: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={valores.obligatorio}
              onCheckedChange={(c) => setValores({ ...valores, obligatorio: c === true })}
            />
            <span>{t('campos.obligatorio')}</span>
          </label>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={valores.deCurso}
                disabled={!puedeCambiarDeCurso}
                onCheckedChange={(c) => setValores({ ...valores, deCurso: c === true })}
              />
              <span>{t('campos.de_curso')}</span>
            </label>
            <p className="text-muted-foreground pl-6 text-xs">
              {t(puedeCambiarDeCurso ? 'de_curso_ayuda' : 'de_curso_fijo')}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancelar')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('guardando') : t('guardar')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
