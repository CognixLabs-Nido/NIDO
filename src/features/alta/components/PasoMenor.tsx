'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
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
import { upsertDatosPedagogicos } from '@/features/datos-pedagogicos/actions/upsert-datos-pedagogicos'
import { actualizarNinoTutor } from '@/features/ninos/actions/actualizar-nino-tutor'
import {
  actualizarNinoTutorObject,
  COMO_NOS_CONOCIO,
  reglasNinoTutor,
} from '@/features/ninos/schemas/nino'
import { SubirFotoNino } from '@/features/ninos/components/SubirFotoNino'

import { actualizarNinoFamilia } from '../actions/actualizar-nino-familia'
import { AcuseAltaCheckbox } from './AcuseAltaCheckbox'
import { SubirDocumentoPdf } from './SubirDocumentoPdf'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { IdentidadInicial, ImagenPanelData } from '../lib/tipos'

export interface DireccionInicial {
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
}

const menorFormSchema = actualizarNinoTutorObject
  .extend({
    direccion_calle: z.string().max(200).optional().nullable(),
    direccion_numero: z.string().max(20).optional().nullable(),
    direccion_cp: z.string().max(12).optional().nullable(),
    direccion_ciudad: z.string().max(120).optional().nullable(),
    direccion_provincia: z.string().max(60).optional().nullable(),
  })
  .superRefine(reglasNinoTutor)
type MenorFormInput = z.infer<typeof menorFormSchema>

interface Props {
  locale: string
  ninoId: string
  ninoNombre: string
  identidadInicial: IdentidadInicial
  /** Fase 5b: «cómo nos has conocido», solo a familias nuevas en el centro (lo decide la página). */
  mostrarComoNosConocio?: boolean
  direccionInicial: DireccionInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  /** `false`: no se pudieron leer; no se ofrece el formulario, que pisaría lo guardado. */
  datosPedagogicosLeidos: boolean
  libroFamiliaUrl: string | null
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  /** ¿El niño ya tiene consent de imagen vigente? (IU-2: el checkbox otorga el consent). */
  imagenAceptado: boolean
  /** ¿Puede dar el consentimiento de imagen? (tutor legal o modo Dirección). Si no, se oculta
   *  la sección de imagen entera (documento, «Cargar documento» y casilla) y se explica por
   *  qué. Por defecto true. */
  puedeConsentirImagen?: boolean
  currentUserId: string
  currentUserNombre: string
  /** PR-3b-2 · B2: firma PRESENCIAL de la autorización de imagen cuando lo rellena Dirección. */
  modoDireccion?: boolean
  /** PR-4d: eleva la dirección del niño al contenedor para el botón "misma dirección"
   *  de los pasos de tutor (el paso del menor se desmonta al navegar). */
  onDireccionChange: (dir: DireccionInicial) => void
  onNext: () => void
  onBack: () => void
}

function idiomaValido(v: string): 'es' | 'en' | 'va' {
  return v === 'en' || v === 'va' ? v : 'es'
}

function comoInicial(v: string | null): (typeof COMO_NOS_CONOCIO)[number] | '' {
  return (COMO_NOS_CONOCIO as readonly string[]).includes(v ?? '')
    ? (v as (typeof COMO_NOS_CONOCIO)[number])
    : ''
}

/** Un `<input type="number">` da texto: vacío → sin valor (el esquema lo pide), si no, número. */
function aNumero(v: string): number | undefined {
  return v === '' ? undefined : Number(v)
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
  mostrarComoNosConocio = false,
  direccionInicial,
  datosPedagogicosInicial,
  datosPedagogicosLeidos,
  libroFamiliaUrl,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  imagenAceptado,
  puedeConsentirImagen = true,
  currentUserId,
  currentUserNombre,
  modoDireccion = false,
  onDireccionChange,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tNino = useTranslations('admin.ninos')
  const tDoc = useTranslations('alta.documentos')
  const tErrors = useTranslations()
  const tPed = useTranslations('pedagogico')
  const router = useRouter()
  const [pendingDatos, startDatos] = useTransition()
  const [pendingImagen, startImagen] = useTransition()
  const [pendingSiguiente, startSiguiente] = useTransition()
  const [imagenOmitida, setImagenOmitida] = useState(false)
  // Consentimiento de imagen vigente (IU-2): gate de la foto de abajo. Se DERIVA en vez de
  // copiarse en estado, porque hay DOS vías de otorgarlo y cada una avisa distinto: el
  // checkbox lo dice por callback (misma pantalla, sin recargar) y la FIRMA del documento
  // llega como prop nueva tras su `router.refresh()`. Un `useState(imagenAceptado)` se
  // quedaría clavado en false tras firmar, porque el inicial solo se lee al montar.
  const [aceptadoEnSesion, setAceptadoEnSesion] = useState(false)
  const imagenOk = imagenAceptado || aceptadoEnSesion

  // Datos pedagógicos elevados del sub-form. Antes su único guardado era el botón propio
  // (desacoplado de "Continuar") → si el tutor rellenaba y avanzaba, se perdía. Ahora se
  // persiste al avanzar. `dirty` = el tutor tocó algo (si no, no se crea fila: es opcional).
  const pedagogicoRef = useRef<{ valores: DatosPedagogicosInput | null; dirty: boolean }>({
    valores: null,
    dirty: false,
  })
  const onPedagogicoCambio = useCallback((valores: DatosPedagogicosInput, dirty: boolean) => {
    pedagogicoRef.current = { valores, dirty }
  }, [])

  function handleSiguiente() {
    const ped = pedagogicoRef.current
    // Vacío/intacto → avanzar sin guardar (el paso pedagógico NO es obligatorio).
    if (!ped.dirty || !ped.valores) {
      onNext()
      return
    }
    const valores = ped.valores
    startSiguiente(async () => {
      const r = await upsertDatosPedagogicos(locale, valores)
      if (!r.success) {
        // Solo bloquea si lo TECLEADO es inválido (p.ej. alimentación "otra" sin nota),
        // para no perderlo; un paso pedagógico vacío nunca llega aquí.
        toast.error(tErrors(r.error))
        return
      }
      onNext()
    })
  }

  const form = useForm<MenorFormInput>({
    resolver: zodResolver(menorFormSchema),
    defaultValues: {
      nino_id: ninoId,
      nombre: ninoNombre,
      primer_apellido: identidadInicial.primer_apellido ?? '',
      segundo_apellido: identidadInicial.segundo_apellido ?? '',
      fecha_nacimiento: identidadInicial.fecha_nacimiento ?? '',
      sexo: identidadInicial.sexo,
      nacionalidad: identidadInicial.nacionalidad ?? '',
      idioma_principal: idiomaValido(identidadInicial.idioma_principal),
      lugar_nacimiento: identidadInicial.lugar_nacimiento ?? '',
      dni: identidadInicial.dni ?? '',
      hermanos_total: identidadInicial.hermanos_total ?? undefined,
      hermanos_lugar: identidadInicial.hermanos_lugar ?? undefined,
      observaciones_familia: identidadInicial.observaciones_familia ?? '',
      como_nos_conocio: comoInicial(identidadInicial.como_nos_conocio),
      como_nos_conocio_otro: identidadInicial.como_nos_conocio_otro ?? '',
      direccion_provincia: identidadInicial.direccion_provincia,
      direccion_calle: direccionInicial.direccion_calle,
      direccion_numero: direccionInicial.direccion_numero,
      direccion_cp: direccionInicial.direccion_cp,
      direccion_ciudad: direccionInicial.direccion_ciudad,
    },
  })

  // PR-4d: sincroniza en vivo la dirección tecleada del niño hacia el contenedor, para que
  // el botón "misma dirección" de los pasos de tutor la lea aunque este paso se desmonte.
  // Solo reacciona a los 4 campos de dirección (no al resto del form).
  useEffect(() => {
    const sub = form.watch((v, { name }) => {
      if (name && !name.startsWith('direccion_')) return
      onDireccionChange({
        direccion_calle: v.direccion_calle ?? null,
        direccion_numero: v.direccion_numero ?? null,
        direccion_cp: v.direccion_cp ?? null,
        direccion_ciudad: v.direccion_ciudad ?? null,
      })
    })
    return () => sub.unsubscribe()
  }, [form, onDireccionChange])

  function guardarDatos(values: MenorFormInput) {
    startDatos(async () => {
      const ident = await actualizarNinoTutor({
        nino_id: values.nino_id,
        nombre: values.nombre,
        primer_apellido: values.primer_apellido,
        segundo_apellido: values.segundo_apellido,
        fecha_nacimiento: values.fecha_nacimiento,
        sexo: values.sexo,
        nacionalidad: values.nacionalidad,
        idioma_principal: values.idioma_principal,
        lugar_nacimiento: values.lugar_nacimiento,
        dni: values.dni ?? '',
        hermanos_total: values.hermanos_total,
        hermanos_lugar: values.hermanos_lugar,
        observaciones_familia: values.observaciones_familia ?? '',
        // Sin la pregunta en pantalla, NULL: lo guardado se queda como está.
        como_nos_conocio: mostrarComoNosConocio ? (values.como_nos_conocio ?? '') : null,
        como_nos_conocio_otro: mostrarComoNosConocio ? (values.como_nos_conocio_otro ?? '') : null,
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
        direccion_provincia: values.direccion_provincia ?? null,
      })
      if (!dir.success) {
        toast.error(tErrors(dir.error))
        return
      }
      // Alta ya validada: lo que cambió de la identidad y del domicilio va a la cola de Dirección y
      // no se aplica hasta que lo apruebe; el resto se guardó. El mensaje dice qué pasó con cada
      // parte (puerta de identidad, 2026-11-08), nunca «guardado» de algo que espera.
      const identidadEnCola = ident.data.pendienteValidacion
      const domicilioEnCola = dir.data.pendienteValidacion === true
      toast.success(
        identidadEnCola && domicilioEnCola
          ? t('validacion.enviado_identidad_domicilio')
          : identidadEnCola
            ? t('validacion.enviado_identidad')
            : domicilioEnCola
              ? t('validacion.enviado_domicilio')
              : t('identidad.guardado')
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
  const comoItems = COMO_NOS_CONOCIO.map((c) => ({
    value: c,
    label: t(`menor.como_nos_conocio_opciones.${c}`),
  }))
  const comoElegido = form.watch('como_nos_conocio')

  return (
    <div className="space-y-6">
      {/* Filiación + dirección */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(guardarDatos)} className="space-y-3">
          {/* Nombre editable por el tutor (PR-4c-2): la RPC `actualizar_identidad_nino_tutor`
              ya incluye `p_nombre` (COALESCE = preservar). Mismo camino whitelisteado. */}
          <FormField
            control={form.control}
            name="nombre"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.nombre')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="primer_apellido"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.primer_apellido')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="segundo_apellido"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino('fields.segundo_apellido')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
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
                <FormLabel>{t('menor.nacionalidad')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lugar_nacimiento"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('menor.lugar_nacimiento')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('menor.dni')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <p className="text-muted-foreground text-xs">{t('menor.dni_ayuda')}</p>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="hermanos_total"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('menor.hermanos_total')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(aNumero(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hermanos_lugar"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('menor.hermanos_lugar')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(aNumero(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <p className="text-muted-foreground text-xs">{t('menor.hermanos_ayuda')}</p>
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
          <FormField
            control={form.control}
            name="direccion_provincia"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('menor.direccion_provincia')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="observaciones_familia"
            render={({ field }) => (
              <FormItem className="border-t pt-4">
                <FormLabel>{t('menor.observaciones')}</FormLabel>
                {/* Decidido el 2026-11-10: lo médico no va aquí, va en la ficha médica. */}
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="aviso-observaciones-medico"
                >
                  {t('menor.observaciones_aviso')}
                </p>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ''} rows={3} maxLength={1000} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {mostrarComoNosConocio && (
            <>
              <FormField
                control={form.control}
                name="como_nos_conocio"
                render={({ field }) => (
                  <FormItem data-testid="pregunta-como-nos-conocio">
                    <FormLabel>{t('menor.como_nos_conocio')}</FormLabel>
                    <Select
                      items={comoItems}
                      value={field.value || null}
                      onValueChange={(v) => field.onChange(v ?? '')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('menor.como_nos_conocio_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {comoItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {comoElegido === 'otro' && (
                <FormField
                  control={form.control}
                  name="como_nos_conocio_otro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('menor.como_nos_conocio_otro')}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} maxLength={200} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </>
          )}
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
        {datosPedagogicosLeidos ? (
          <DatosPedagogicosForm
            ninoId={ninoId}
            locale={locale}
            initial={datosPedagogicosInicial}
            onCambio={onPedagogicoCambio}
            ocultarGuardar
          />
        ) : (
          <p className="text-destructive text-sm" role="alert" data-testid="pedagogicos-no-leidos">
            {tPed('no_leidos_alta')}
          </p>
        )}
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

      {/* Foto del niño. La subida depende del consentimiento de imagen, que se otorga JUSTO
          debajo: se bloquea el botón mientras falte y se dice por qué, en vez de dejar que
          el usuario suba la foto entera para recibir un 403 quince segundos después. */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{t('imagen.foto_titulo')}</h3>
        <SubirFotoNino
          ninoId={ninoId}
          locale={locale}
          initialUrl={fotoInicialUrl}
          alt={ninoNombre}
          bloqueado={!imagenOk}
          motivoBloqueo={
            puedeConsentirImagen
              ? t('imagen.foto_requiere_autorizacion')
              : t('imagen.solo_tutor_legal')
          }
        />
      </section>

      {/* Autorización de imagen — acuse por checkbox SIEMPRE disponible (vía B). Si el centro
          tiene plantilla, se puede además instanciar/abrir/firmar el documento real. */}
      <section className="space-y-3 border-t pt-4" data-testid="alta-imagen-autorizacion">
        <h3 className="text-sm font-semibold">{t('imagen.autorizacion_titulo')}</h3>
        {!puedeConsentirImagen ? (
          <p className="text-muted-foreground text-sm" data-testid="alta-imagen-solo-tutor-legal">
            {t('imagen.solo_tutor_legal')}
          </p>
        ) : imagenPanel ? (
          <FirmarAutorizacionPanel
            autorizacionId={imagenPanel.autorizacionId}
            tipo="autorizacion_imagenes"
            firmable={imagenPanel.firmable}
            roster={imagenPanel.roster}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            presencial={modoDireccion}
          />
        ) : (
          !omitirImagen && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">{t('imagen.cargar_ayuda')}</p>
              <Button type="button" onClick={instanciarImagen} disabled={pendingImagen}>
                {pendingImagen ? t('wizard.guardando') : t('imagen.cargar')}
              </Button>
            </div>
          )
        )}
        {puedeConsentirImagen && (
          <AcuseAltaCheckbox
            ninoId={ninoId}
            aceptadoInicial={imagenAceptado}
            onAceptado={() => setAceptadoEnSesion(true)}
          />
        )}
      </section>

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        <Button type="button" onClick={handleSiguiente} disabled={pendingSiguiente}>
          {pendingSiguiente ? t('wizard.guardando') : t('wizard.siguiente')}
        </Button>
      </div>
    </div>
  )
}
