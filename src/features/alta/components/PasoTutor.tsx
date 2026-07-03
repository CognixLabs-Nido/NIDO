'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
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

import { actualizarNinoFamilia } from '../actions/actualizar-nino-familia'
import { guardarDatosTutor } from '../actions/guardar-datos-tutor'
import {
  estadoCivilEnum,
  type EstadoCivil,
  type TipoVinculoLegal,
} from '../schemas/alta-documentos'
import { SubirDocumentoPdf } from './SubirDocumentoPdf'
import type { DireccionInicial } from './PasoMenor'

const ESTADO_CIVIL_OPCIONES: EstadoCivil[] = [
  'casados',
  'separados',
  'divorciados',
  'pareja_de_hecho',
  'soltero',
  'viudo',
]

export interface DatosTutorInicial {
  email: string | null
  nombre_completo: string | null
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
  dni_url: string | null
}

const tutorFormSchema = z.object({
  email: z.string().email('alta.documentos.errors.email').max(255).optional().nullable(),
  nombre_completo: z
    .string()
    .min(2, 'alta.documentos.errors.nombre')
    .max(120)
    .optional()
    .nullable(),
  direccion_calle: z.string().max(200).optional().nullable(),
  direccion_numero: z.string().max(20).optional().nullable(),
  direccion_cp: z.string().max(12).optional().nullable(),
  direccion_ciudad: z.string().max(120).optional().nullable(),
  estado_civil_familia: estadoCivilEnum.optional().nullable(),
})
type TutorFormInput = z.infer<typeof tutorFormSchema>

interface Props {
  locale: string
  ninoId: string
  tipoVinculo: TipoVinculoLegal
  inicial: DatosTutorInicial | null
  estadoCivilInicial: EstadoCivil | null
  /** Solo el tutor 1 captura el estado civil de la familia (1 valor por familia). */
  mostrarEstadoCivil: boolean
  /** El email del tutor 1 es el de su cuenta → read-only. El del tutor 2 es editable. */
  emailReadonly: boolean
  /** El tutor 2 es OPCIONAL: se puede saltar sin guardar. */
  opcional: boolean
  /** PR-4d: dirección tecleada del niño (elevada al contenedor) para el botón de copia. */
  direccionNino: DireccionInicial | null
  onNext: () => void
  onBack: () => void
}

/**
 * Pasos 4 y 5 del alta (G-1) — datos del tutor 1 (principal) y del tutor 2 (secundario,
 * OPCIONAL y sin cuenta). Un submit: `guardarDatosTutor` (upsert de `datos_tutor`) y, solo
 * para el tutor 1, `actualizarNinoFamilia` con `estado_civil_familia` (1 valor por familia,
 * decisión F). El DNI (2 caras → PDF) lo sube `SubirDocumentoPdf` a su ruta. El tutor 2 se
 * salta limpio con "No hay segundo tutor" (avanza sin escribir nada).
 */
export function PasoTutor({
  locale,
  ninoId,
  tipoVinculo,
  inicial,
  estadoCivilInicial,
  mostrarEstadoCivil,
  emailReadonly,
  opcional,
  direccionNino,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tDoc = useTranslations('alta.documentos')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  // PR-4d: ¿el niño tiene alguna dirección tecleada? Si no, el botón de copia se deshabilita.
  const hayDireccionNino = Boolean(
    direccionNino?.direccion_calle ||
    direccionNino?.direccion_numero ||
    direccionNino?.direccion_cp ||
    direccionNino?.direccion_ciudad
  )

  const form = useForm<TutorFormInput>({
    resolver: zodResolver(tutorFormSchema),
    defaultValues: {
      email: inicial?.email ?? '',
      nombre_completo: inicial?.nombre_completo ?? '',
      direccion_calle: inicial?.direccion_calle ?? '',
      direccion_numero: inicial?.direccion_numero ?? '',
      direccion_cp: inicial?.direccion_cp ?? '',
      direccion_ciudad: inicial?.direccion_ciudad ?? '',
      estado_civil_familia: estadoCivilInicial,
    },
  })

  // Copia la dirección del niño a los campos del tutor, que quedan EDITABLES (setValue no
  // los bloquea). No afecta al niño ni al otro tutor: cada form es independiente.
  function copiarDireccionNino() {
    if (!direccionNino) return
    form.setValue('direccion_calle', direccionNino.direccion_calle ?? '', { shouldDirty: true })
    form.setValue('direccion_numero', direccionNino.direccion_numero ?? '', { shouldDirty: true })
    form.setValue('direccion_cp', direccionNino.direccion_cp ?? '', { shouldDirty: true })
    form.setValue('direccion_ciudad', direccionNino.direccion_ciudad ?? '', { shouldDirty: true })
  }

  function onSubmit(values: TutorFormInput) {
    startTransition(async () => {
      const r = await guardarDatosTutor({
        nino_id: ninoId,
        tipo_vinculo: tipoVinculo,
        email: values.email || null,
        nombre_completo: values.nombre_completo || null,
        direccion_calle: values.direccion_calle || null,
        direccion_numero: values.direccion_numero || null,
        direccion_cp: values.direccion_cp || null,
        direccion_ciudad: values.direccion_ciudad || null,
      })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      if (mostrarEstadoCivil && values.estado_civil_familia) {
        const ec = await actualizarNinoFamilia({
          nino_id: ninoId,
          estado_civil_familia: values.estado_civil_familia,
        })
        if (!ec.success) {
          toast.error(tErrors(ec.error))
          return
        }
      }
      // Alta ya validada (decisión J): los datos del tutor se encolaron a validación.
      toast.success(r.data.pendienteValidacion ? t('validacion.enviado') : t('tutor.guardado'))
      onNext()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="nombre_completo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tutor.nombre')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tutor.email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  {...field}
                  value={field.value ?? ''}
                  readOnly={emailReadonly}
                  disabled={emailReadonly}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t('menor.direccion_titulo')}</h3>
          {/* PR-4d: copia la dirección del niño (editable tras copiar). Deshabilitado si el
              niño aún no tiene dirección tecleada → no rompe. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copiarDireccionNino}
            disabled={!hayDireccionNino}
          >
            {t('tutor.misma_direccion')}
          </Button>
        </div>
        <FormField
          control={form.control}
          name="direccion_calle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('menor.direccion_calle')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="direccion_numero"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('menor.direccion_numero')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="direccion_cp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('menor.direccion_cp')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="direccion_ciudad"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('menor.direccion_ciudad')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {mostrarEstadoCivil && (
          <FormField
            control={form.control}
            name="estado_civil_familia"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('tutor.estado_civil')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('tutor.estado_civil_placeholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ESTADO_CIVIL_OPCIONES.map((e) => (
                      <SelectItem key={e} value={e}>
                        {t(`tutor.estado_civil_opciones.${e}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* DNI (2 caras → PDF) */}
        <div className="border-t pt-4">
          <SubirDocumentoPdf
            locale={locale}
            ninoId={ninoId}
            endpoint="dni"
            extraFields={{ tipo_vinculo: tipoVinculo }}
            initialUrl={inicial?.dni_url ?? null}
            titulo={tDoc('dni_titulo')}
            ayuda={tDoc('dni_ayuda')}
          />
        </div>

        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <div className="flex gap-2">
            {opcional && (
              <Button type="button" variant="ghost" onClick={onNext} disabled={pending}>
                {t('tutor.sin_segundo')}
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? t('wizard.guardando') : t('wizard.guardar_siguiente')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
