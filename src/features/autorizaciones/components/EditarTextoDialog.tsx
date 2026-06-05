'use client'

import { useState, useTransition } from 'react'

import { PencilIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { editarTextoAutorizacion } from '../actions/gestionar-autorizacion'

interface Props {
  autorizacionId: string
  titulo: string
  texto: string
  textoDefinitivo: boolean
  vigenciaHasta: string | null
}

/**
 * Admin teclea/edita el texto de la autorización y lo marca definitivo. El texto
 * legal real lo pega el responsable; en pruebas vale cualquier texto. Un texto
 * `PENDIENTE` no puede marcarse definitivo (guard). Bloqueado en BD si ya hay firmas.
 */
export function EditarTextoDialog({
  autorizacionId,
  titulo,
  texto,
  textoDefinitivo,
  vigenciaHasta,
}: Props) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tituloVal, setTituloVal] = useState(titulo)
  const [textoVal, setTextoVal] = useState(texto === 'PENDIENTE' ? '' : texto)
  const [definitivo, setDefinitivo] = useState(textoDefinitivo)
  const [vigencia, setVigencia] = useState(vigenciaHasta ?? '')
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    startTransition(async () => {
      const res = await editarTextoAutorizacion({
        autorizacion_id: autorizacionId,
        titulo: tituloVal.trim(),
        texto: textoVal.trim(),
        texto_definitivo: definitivo,
        vigencia_hasta: vigencia.trim() === '' ? null : vigencia.trim(),
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.texto_guardado'))
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <PencilIcon className="mr-1 size-4" />
            {t('acciones.editar_texto')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('acciones.editar_texto')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-titulo">{t('form.titulo')}</Label>
            <Input
              id="edit-titulo"
              value={tituloVal}
              onChange={(e) => setTituloVal(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-texto">{t('form.texto')}</Label>
            <Textarea
              id="edit-texto"
              value={textoVal}
              onChange={(e) => setTextoVal(e.target.value)}
              rows={8}
              maxLength={20000}
              placeholder={t('form.texto_placeholder')}
            />
            <p className="text-muted-foreground text-xs">{t('form.texto_legal_aviso')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-vigencia">{t('form.vigencia_hasta')}</Label>
            <Input
              id="edit-vigencia"
              type="date"
              value={vigencia}
              onChange={(e) => setVigencia(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={definitivo} onCheckedChange={(v) => setDefinitivo(v === true)} />
            {t('form.texto_definitivo')}
          </label>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('acciones.guardando') : t('acciones.guardar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
