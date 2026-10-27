'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Resultado = { success: true } | { success: false; error: string }

/** Lo que recoge el diálogo. Las acciones llegan atadas a su id (`accion.bind(null, id)`). */
export interface DatosDialogo {
  texto: string
  casilla: boolean
}

/**
 * Un botón que abre un diálogo y lanza una acción de las peticiones de olvido. Con `texto`, pide
 * un texto (el motivo de un rechazo, la nota para la familia); con `casilla`, una casilla (borrar
 * sin esperar los 7 días).
 */
export function DialogoOlvido({
  cta,
  titulo,
  explicacion,
  confirmar,
  destructiva,
  variante = 'outline',
  texto,
  casilla,
  accion,
}: {
  cta: string
  titulo: string
  explicacion: string
  confirmar: string
  destructiva?: boolean
  variante?: 'outline' | 'default' | 'ghost'
  texto?: { etiqueta: string; inicial?: string; obligatorio?: boolean }
  casilla?: { etiqueta: string }
  accion: (datos: DatosDialogo) => Promise<Resultado>
}) {
  const t = useTranslations('olvido')
  const tErrores = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [valor, setValor] = useState(texto?.inicial ?? '')
  const [marcada, setMarcada] = useState(false)
  const [pending, startTransition] = useTransition()

  function ejecutar() {
    startTransition(async () => {
      const r = await accion({ texto: valor, casilla: marcada })
      if (!r.success) {
        toast.error(tErrores(r.error))
        return
      }
      setOpen(false)
      toast.success(t('hecho'))
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={destructiva && variante === 'ghost' ? 'ghost' : variante}
            size="sm"
            className={destructiva && variante === 'ghost' ? 'text-destructive' : undefined}
          >
            {cta}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{explicacion}</p>
        {texto && (
          <div className="space-y-1">
            <Label htmlFor="olvido-texto" className="text-xs">
              {texto.etiqueta}
            </Label>
            <Textarea
              id="olvido-texto"
              rows={3}
              maxLength={1000}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
        )}
        {casilla && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="olvido-casilla"
              checked={marcada}
              onCheckedChange={(c) => setMarcada(c === true)}
            />
            <Label htmlFor="olvido-casilla" className="text-xs font-normal">
              {casilla.etiqueta}
            </Label>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancelar')}
          </Button>
          <Button
            type="button"
            variant={destructiva ? 'destructive' : 'default'}
            disabled={pending || (!!texto?.obligatorio && !valor.trim())}
            onClick={ejecutar}
          >
            {confirmar}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
