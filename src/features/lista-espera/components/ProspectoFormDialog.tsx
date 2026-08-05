'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { crearProspecto } from '../actions/crear-prospecto'
import { editarProspecto } from '../actions/editar-prospecto'
import { resolverTutorParaProspecto } from '../actions/resolver-tutor'
import type { DeteccionTutor } from '../lib/deteccion-tutor'
import type { ProspectoListItem } from '../queries/get-lista-espera'

interface FormValues {
  nombre_nino: string
  apellidos_nino: string
  fecha_nacimiento: string
  telefono_tutor: string
  email_tutor: string
  nota: string
}

interface Props {
  /** Curso destino del prospecto (alta). */
  cursoId: string
  /** Si se pasa, el diálogo edita ese prospecto; si no, crea uno nuevo. */
  prospecto?: ProspectoListItem
  trigger: React.ReactNode
}

export function ProspectoFormDialog({ cursoId, prospecto, trigger }: Props) {
  const t = useTranslations('admin.admisiones')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const esEdicion = !!prospecto

  // U-5 (D7): vista previa de la detección por email. Solo al CREAR — al editar no se
  // reclasifica el prospecto, así que anunciarlo confundiría. `null` = aún sin resolver.
  const [deteccion, setDeteccion] = useState<DeteccionTutor | null>(null)
  const [familiaEtiqueta, setFamiliaEtiqueta] = useState<string | null>(null)
  const [resolviendo, startResolver] = useTransition()

  /**
   * Resuelve al salir del campo de email (no en cada tecla: cada resolución es un viaje al
   * servidor). Es informativo: la resolución que se persiste la rehace `crearProspecto`.
   */
  function resolverEmail(email: string) {
    if (esEdicion) return
    const limpio = email.trim()
    if (!limpio) {
      setDeteccion(null)
      setFamiliaEtiqueta(null)
      return
    }
    startResolver(async () => {
      const r = await resolverTutorParaProspecto(limpio)
      if (r.success) {
        setDeteccion(r.data.deteccion)
        setFamiliaEtiqueta(r.data.familiaEtiqueta)
      } else {
        // Sin vista previa no se bloquea el alta: `crearProspecto` reintenta la resolución
        // y, si tampoco puede, es ÉL quien aborta con el mismo error.
        setDeteccion(null)
        setFamiliaEtiqueta(null)
      }
    })
  }

  const form = useForm<FormValues>({
    defaultValues: {
      nombre_nino: prospecto?.nombre_nino ?? '',
      apellidos_nino: prospecto?.apellidos_nino ?? '',
      fecha_nacimiento: prospecto?.fecha_nacimiento ?? '',
      telefono_tutor: prospecto?.telefono_tutor ?? '',
      email_tutor: prospecto?.email_tutor ?? '',
      nota: prospecto?.nota ?? '',
    },
  })

  function onSubmit(values: FormValues) {
    start(async () => {
      const r = esEdicion
        ? await editarProspecto({ id: prospecto!.id, ...values })
        : await crearProspecto({ curso_academico_id: cursoId, ...values })
      if (r.success) {
        toast.success(esEdicion ? t('editado') : t('creado'))
        if (!esEdicion) {
          form.reset()
          setDeteccion(null)
          setFamiliaEtiqueta(null)
        }
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{esEdicion ? t('editar_title') : t('nuevo_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nombre_nino">{t('fields.nombre_nino')}</Label>
            <Input
              id="nombre_nino"
              {...form.register('nombre_nino', { required: true })}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apellidos_nino">{t('fields.apellidos_nino')}</Label>
            <Input
              id="apellidos_nino"
              {...form.register('apellidos_nino', { required: true })}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fecha_nacimiento">{t('fields.fecha_nacimiento')}</Label>
            <Input id="fecha_nacimiento" type="date" {...form.register('fecha_nacimiento')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telefono_tutor">{t('fields.telefono_tutor')}</Label>
            <Input id="telefono_tutor" {...form.register('telefono_tutor')} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email_tutor">{t('fields.email_tutor')}</Label>
            <Input
              id="email_tutor"
              type="email"
              {...form.register('email_tutor', {
                onBlur: (e: React.FocusEvent<HTMLInputElement>) => resolverEmail(e.target.value),
              })}
              autoComplete="off"
            />
            {!esEdicion && (
              <p className="text-muted-foreground text-xs" aria-live="polite">
                {resolviendo
                  ? t('deteccion.resolviendo')
                  : deteccion === 'familia_existente'
                    ? t('deteccion.familia_existente', { familia: familiaEtiqueta ?? '—' })
                    : deteccion === 'cuenta_sin_familia_aqui'
                      ? t('deteccion.cuenta_sin_familia_aqui')
                      : deteccion === 'familia_nueva'
                        ? t('deteccion.familia_nueva')
                        : t('deteccion.ayuda')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nota">{t('fields.nota')}</Label>
            <Textarea id="nota" rows={3} {...form.register('nota')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
