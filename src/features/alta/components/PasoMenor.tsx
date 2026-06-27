'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
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
import { crearImagenAutorizacion } from '@/features/autorizaciones/actions/crear-imagen'
import { FirmarAutorizacionPanel } from '@/features/autorizaciones/components/FirmarAutorizacionPanel'
import { DatosPedagogicosForm } from '@/features/datos-pedagogicos/components/DatosPedagogicosForm'
import { actualizarNinoTutor } from '@/features/ninos/actions/actualizar-nino-tutor'
import { actualizarNinoTutorSchema } from '@/features/ninos/schemas/nino'
import { SubirFotoNino } from '@/features/ninos/components/SubirFotoNino'

import { actualizarNinoFamilia } from '../actions/actualizar-nino-familia'
import { SubirDocumentoPdf } from './SubirDocumentoPdf'
import type { IdentidadInicial } from './PasoIdentidad'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { ImagenPanelData } from '../lib/tipos'

export interface DireccionInicial {
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
}

const menorFormSchema = actualizarNinoTutorSchema.extend({
  direccion_calle: z.string().max(200).optional().nullable(),
  direccion_numero: z.string().max(20).optional().nullable(),
  direccion_cp: z.string().max(12).optional().nullable(),
  direccion_ciudad: z.string().max(120).optional().nullable(),
})
type MenorFormInput = z.infer<typeof menorFormSchema>

interface Props {
  locale: string
  ninoId: string
  ninoNombre: string
  identidadInicial: IdentidadInicial
  direccionInicial: DireccionInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  libroFamiliaUrl: string | null
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  currentUserId: string
  currentUserNombre: string
  onNext: () => void
  onBack: () => void
}

function idiomaValido(v: string): 'es' | 'en' | 'va' {
  return v === 'en' || v === 'va' ? v : 'es'
}

/**
 * Paso 3 del alta (G-1) — **Datos del menor**. Agrupa: filiación + dirección (un submit:
 * `actualizarNinoTutor` para la identidad whitelisteada + `actualizarNinoFamilia` para la
 * dirección, vía service role tras autorizar), el cuestionario pedagógico (reusa
 * `DatosPedagogicosForm`), el **libro de familia** (multi-imagen → PDF), la **foto** y la
 * **autorización de imagen** (instancia lazy + firma, como el paso de imagen del flujo
 * previo). Cada bloque persiste por su cuenta; "Continuar" avanza (no finaliza el alta).
 */
export function PasoMenor({
  locale,
  ninoId,
  ninoNombre,
  identidadInicial,
  direccionInicial,
  datosPedagogicosInicial,
  libroFamiliaUrl,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  currentUserId,
  currentUserNombre,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tNino = useTranslations('admin.ninos')
  const tDoc = useTranslations('alta.documentos')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pendingDatos, startDatos] = useTransition()
  const [pendingImagen, startImagen] = useTransition()
  const [imagenOmitida, setImagenOmitida] = useState(false)

  const form = useForm<MenorFormInput>({
    resolver: zodResolver(menorFormSchema),
    defaultValues: {
      nino_id: ninoId,
      apellidos: identidadInicial.apellidos ?? '',
      fecha_nacimiento: identidadInicial.fecha_nacimiento ?? '',
      sexo: identidadInicial.sexo,
      nacionalidad: identidadInicial.nacionalidad,
      idioma_principal: idiomaValido(identidadInicial.idioma_principal),
      direccion_calle: direccionInicial.direccion_calle,
      direccion_numero: direccionInicial.direccion_numero,
      direccion_cp: direccionInicial.direccion_cp,
      direccion_ciudad: direccionInicial.direccion_ciudad,
    },
  })

  function guardarDatos(values: MenorFormInput) {
    startDatos(async () => {
      const ident = await actualizarNinoTutor({
        nino_id: values.nino_id,
        apellidos: values.apellidos,
        fecha_nacimiento: values.fecha_nacimiento,
        sexo: values.sexo,
        nacionalidad: values.nacionalidad,
        idioma_principal: values.idioma_principal,
      })
      if (!ident.success) {
        toast.error(tErrors(ident.error))
        return
      }
      const dir = await actualizarNinoFamilia({
        nino_id: values.nino_id,
        direccion_calle: values.direccion_calle ?? null,
        direccion_numero: values.direccion_numero ?? null,
        direccion_cp: values.direccion_cp ?? null,
        direccion_ciudad: values.direccion_ciudad ?? null,
      })
      if (!dir.success) {
        toast.error(tErrors(dir.error))
        return
      }
      // Alta ya validada (decisión J): la dirección se encoló a validación de dirección.
      toast.success(
        dir.data.pendienteValidacion ? t('validacion.enviado') : t('identidad.guardado')
      )
    })
  }

  function instanciarImagen() {
    startImagen(async () => {
      const r = await crearImagenAutorizacion({ nino_id: ninoId })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      if (r.data.estado === 'sin_plantilla') {
        setImagenOmitida(true)
        return
      }
      router.refresh()
    })
  }

  const sexoItems = [
    { value: 'F', label: tNino('sexo_opciones.F') },
    { value: 'M', label: tNino('sexo_opciones.M') },
    { value: 'X', label: tNino('sexo_opciones.X') },
    { value: null, label: tNino('sexo_opciones.no_contesta') },
  ]
  const omitirImagen = imagenSinPlantilla || imagenOmitida

  return (
    <div className="space-y-6">
      {/* Filiación + dirección */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(guardarDatos)} className="space-y-3">
          <FormItem>
            <FormLabel>{tNino('fields.nombre')}</FormLabel>
            <FormControl>
              <Input value={ninoNombre} disabled readOnly />
            </FormControl>
          </FormItem>
          <FormField
            control={form.control}
            name="apellidos"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.apellidos')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fecha_nacimiento"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.fecha_nacimiento')}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sexo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.sexo')}</FormLabel>
                <Select items={sexoItems} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={tNino('fields.sexo_placeholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {sexoItems.map((item) => (
                      <SelectItem key={String(item.value)} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nacionalidad"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.nacionalidad')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="idioma_principal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.idioma_principal')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="va">Valencià</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <h3 className="border-t pt-4 text-sm font-semibold">{t('menor.direccion_titulo')}</h3>
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
          <div className="flex justify-end">
            <Button type="submit" disabled={pendingDatos}>
              {pendingDatos ? t('wizard.guardando') : t('menor.guardar_datos')}
            </Button>
          </div>
        </form>
      </Form>

      {/* Datos pedagógicos */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('menor.pedagogicos_titulo')}</h3>
        <DatosPedagogicosForm ninoId={ninoId} locale={locale} initial={datosPedagogicosInicial} />
      </section>

      {/* Libro de familia */}
      <section className="space-y-3 border-t pt-4">
        <SubirDocumentoPdf
          locale={locale}
          ninoId={ninoId}
          endpoint="libro-familia"
          initialUrl={libroFamiliaUrl}
          titulo={tDoc('libro_familia_titulo')}
          ayuda={tDoc('libro_familia_ayuda')}
        />
      </section>

      {/* Foto del niño */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('imagen.foto_titulo')}</h3>
        <SubirFotoNino
          ninoId={ninoId}
          locale={locale}
          initialUrl={fotoInicialUrl}
          alt={ninoNombre}
        />
      </section>

      {/* Autorización de imagen */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('imagen.autorizacion_titulo')}</h3>
        {omitirImagen ? (
          <p className="text-muted-foreground text-sm">{t('imagen.sin_plantilla')}</p>
        ) : imagenPanel ? (
          <FirmarAutorizacionPanel
            autorizacionId={imagenPanel.autorizacionId}
            tipo="autorizacion_imagenes"
            firmable={imagenPanel.firmable}
            roster={imagenPanel.roster}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">{t('imagen.cargar_ayuda')}</p>
            <Button type="button" onClick={instanciarImagen} disabled={pendingImagen}>
              {pendingImagen ? t('wizard.guardando') : t('imagen.cargar')}
            </Button>
          </div>
        )}
      </section>

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        <Button type="button" onClick={onNext}>
          {t('wizard.siguiente')}
        </Button>
      </div>
    </div>
  )
}
