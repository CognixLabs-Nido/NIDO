'use client'

import { useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { crearCita } from '../actions/crear-cita'
import type { InvitadoInput } from '../schemas/citas'
import type { TipoCita } from '../types'

export interface NinoOpt {
  id: string
  nombre: string
  apellidos: string
}
export interface AulaOpt {
  id: string
  nombre: string
}
export interface ProfeOpt {
  id: string
  nombre: string
}

interface Props {
  rol: 'admin' | 'profe'
  ninos: NinoOpt[]
  aulas: AulaOpt[]
  profes: ProfeOpt[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fecha prefijada (botón "+ Nueva cita" = ancla; onClickDia = día pulsado). */
  fechaInicial: string
}

const formSchema = z
  .object({
    tipo: z.enum(['reunion_familia', 'reunion_clase', 'reunion_claustro', 'visita']),
    nino_id: z.string().optional(),
    aula_id: z.string().optional(),
    nombre_externo: z.string().max(200).optional(),
    profe_id: z.string().optional(),
    titulo: z
      .string()
      .min(1, 'citas.validation.titulo_vacio')
      .max(200, 'citas.validation.titulo_largo'),
    descripcion: z.string().max(2000).optional(),
    lugar: z.string().max(200).optional(),
    fecha: z.string().min(1),
    hora_inicio: z.string().min(1, 'citas.validation.hora_invalida'),
    hora_fin: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === 'reunion_familia' && !v.nino_id)
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'citas.validation.nino_requerido',
      })
    if (v.tipo === 'reunion_clase' && !v.aula_id)
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'citas.validation.aula_requerida',
      })
    if (v.tipo === 'visita' && !v.nombre_externo)
      ctx.addIssue({
        code: 'custom',
        path: ['nombre_externo'],
        message: 'citas.validation.externo_requerido',
      })
    if (v.hora_fin && v.hora_fin <= v.hora_inicio)
      ctx.addIssue({
        code: 'custom',
        path: ['hora_fin'],
        message: 'citas.validation.hora_fin_invalida',
      })
  })

type FormValues = z.infer<typeof formSchema>

const TIPOS_POR_ROL: Record<'admin' | 'profe', TipoCita[]> = {
  admin: ['reunion_familia', 'reunion_clase', 'reunion_claustro', 'visita'],
  profe: ['reunion_familia', 'reunion_clase'],
}

export function CitaFormDialog({
  rol,
  ninos,
  aulas,
  profes,
  open,
  onOpenChange,
  fechaInicial,
}: Props) {
  const t = useTranslations('citas')
  const tErr = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipo: rol === 'profe' ? 'reunion_familia' : 'reunion_familia',
      titulo: '',
      fecha: fechaInicial,
      hora_inicio: '09:00',
    },
  })

  // Reabre con la fecha prefijada cuando cambia el día pulsado / se abre.
  useEffect(() => {
    if (open)
      form.reset({ tipo: 'reunion_familia', titulo: '', fecha: fechaInicial, hora_inicio: '09:00' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fechaInicial])

  const tipo = form.watch('tipo')

  function onSubmit(v: FormValues) {
    const invitados: InvitadoInput[] = []
    if (v.tipo === 'visita') {
      if (v.nombre_externo) invitados.push({ tipo: 'externo', nombre_externo: v.nombre_externo })
      if (v.profe_id) invitados.push({ tipo: 'usuario', usuario_id: v.profe_id })
    }
    startTransition(async () => {
      const res = await crearCita({
        tipo: v.tipo,
        nino_id: v.tipo === 'reunion_familia' ? (v.nino_id ?? null) : null,
        aula_id: v.tipo === 'reunion_clase' ? (v.aula_id ?? null) : null,
        titulo: v.titulo,
        descripcion: v.descripcion || undefined,
        lugar: v.lugar || undefined,
        fecha: v.fecha,
        hora_inicio: v.hora_inicio,
        hora_fin: v.hora_fin || undefined,
        invitados,
      })
      if (res.success) {
        toast.success(t('alta.creada'))
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(tErr(res.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('alta.titulo')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('campos.tipo')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIPOS_POR_ROL[rol].map((tp) => (
                        <SelectItem key={tp} value={tp}>
                          {t(`tipos.${tp}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {tipo === 'reunion_familia' && (
              <FormField
                control={form.control}
                name="nino_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('campos.nino')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('campos.nino_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ninos.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            {n.nombre} {n.apellidos}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {tipo === 'reunion_clase' && (
              <FormField
                control={form.control}
                name="aula_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('campos.aula')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('campos.aula_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {aulas.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {tipo === 'visita' && (
              <>
                <FormField
                  control={form.control}
                  name="nombre_externo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('campos.externo')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('campos.externo_placeholder')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {profes.length > 0 && (
                  <FormField
                    control={form.control}
                    name="profe_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('campos.staff_opcional')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('campos.staff_placeholder')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {profes.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            {tipo === 'reunion_claustro' && (
              <p className="text-muted-foreground text-sm">{t('alta.claustro_hint')}</p>
            )}

            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('campos.titulo')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="fecha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('campos.fecha')}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hora_inicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('campos.hora_inicio')}</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hora_fin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('campos.hora_fin')}</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="lugar"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('campos.lugar')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('campos.descripcion')}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('alta.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {t('alta.crear')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
