'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

import { CheckCircle2Icon, FileTextIcon, LandmarkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FirmaPad } from '@/features/autorizaciones/components/FirmaPad'
import { safeTranslateError } from '@/shared/lib/safe-translate'

import { sepaMandatoFormSchema, type SepaMandatoFormInput } from '../schemas/sepa'

import type { MandatoFamiliaActivo } from '../queries/get-mandato-familia'

export interface MandatoSepaInicial {
  titular: string
  identificador: string
  documentoUrl: string | null
}

interface RespuestaMandato {
  success: boolean
  error?: string
  /** 2026-11-20: con la familia ya validada, el mandato espera a Dirección en la cola. */
  pendiente?: boolean
  mandato?: { identificador: string; id: string | null; conDocumento: boolean }
}

interface Props {
  locale: string
  ninoId: string
  centroNombre: string
  centroDireccion: string
  /**
   * El CID del centro (0c-2): va en el PDF y en el texto canónico v2. Sin él el paso no aparece
   * (el wizard no lo monta), así que aquí siempre lo hay.
   */
  centroCid: string
  inicial: MandatoSepaInicial | null
  /**
   * F-2c-2: mandato SEPA activo de la FAMILIA (o null). Si existe, el paso 8 es INFORMATIVO
   * (domiciliación ya activa, enmascarada `****{ultimos4}`): no re-pide IBAN/firma ni llama al
   * route de registro; el mandato de la familia ya cubre a este niño. Solo se finaliza.
   */
  mandatoFamilia: MandatoFamiliaActivo | null
  /**
   * Estado tecleado ELEVADO al contenedor (PR-4a-2): así sobrevive al desmontaje del paso
   * al navegar. El paso lee/escribe vía estos props+setters; no guarda nada en BD hasta
   * finalizar. NOTA: `firma` (trazo) se conserva como dato para la finalización, pero el
   * lienzo de `FirmaPad` no re-dibuja el trazo al remontar (no expone prop de valor).
   */
  firma: string | null
  onFirmaChange: (v: string | null) => void
  iban: string
  onIbanChange: (v: string) => void
  titular: string
  onTitularChange: (v: string) => void
  /** «NIF o documento de identidad» y dirección del titular (0c-2), elevados como el titular. */
  titularDocumento: string
  onTitularDocumentoChange: (v: string) => void
  titularDireccion: string
  onTitularDireccionChange: (v: string) => void
  nombreTecleado: string
  onNombreTecleadoChange: (v: string) => void
  /** PR-3b-2 · B2: modo Dirección → mandato PRESENCIAL (sin trazo; PDF con nota "en papel"). */
  modoDireccion?: boolean
  /** Último paso: al guardar (o al omitir) se finaliza el alta. */
  onFinalizar: () => void
  /**
   * Fase 10b-2: `false` cuando detrás viene la firma de la ficha (la familia): los botones dicen
   * «Siguiente» y «Guardar y continuar», no «Finalizar». Por defecto true (el alta en papel).
   */
  esUltimo?: boolean
  onBack: () => void
}

/**
 * Paso 8 del alta (F11-G-2) — IBAN + mandato SEPA Core. El tutor 1 (titular) introduce el
 * IBAN (validado por estructura y dígitos de control), revisa el texto del mandato (acreedor
 * = centro, adeudo recurrente) y firma con trazo (`FirmaPad`). Manda los datos y el trazo a la
 * ruta del mandato; desde el 2026-11-22 el PDF, el identificador y el sello los hace el SERVIDOR
 * (cierre del mandato, `docs/specs/mandato-sepa-cierre.md`). Es el último paso: al guardar el
 * mandato — o al omitirlo — se finaliza el alta.
 */
export function PasoSepa({
  locale,
  ninoId,
  centroNombre,
  centroDireccion,
  centroCid,
  inicial,
  mandatoFamilia,
  firma,
  onFirmaChange,
  iban,
  onIbanChange,
  titular,
  onTitularChange,
  titularDocumento,
  onTitularDocumentoChange,
  titularDireccion,
  onTitularDireccionChange,
  nombreTecleado,
  onNombreTecleadoChange,
  modoDireccion = false,
  onFinalizar,
  esUltimo = true,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tSepa = useTranslations('alta.sepa')
  const tErrors = useTranslations()
  const [subido, setSubido] = useState<boolean>(Boolean(inicial))
  const [enCola, setEnCola] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(inicial?.documentoUrl ?? null)
  const [pending, startTransition] = useTransition()

  const form = useForm<SepaMandatoFormInput>({
    resolver: zodResolver(sepaMandatoFormSchema),
    // Se siembran desde el estado elevado al contenedor: al remontar el paso tras navegar,
    // el IBAN/titular tecleados se recuperan (no se pierden). El IBAN cifrado en reposo
    // (G-2bis) nunca se pre-rellena desde BD; aquí solo persiste lo tecleado en memoria.
    defaultValues: {
      iban,
      titular,
      titular_documento: titularDocumento,
      titular_direccion: titularDireccion,
    },
  })

  function onSubmit(values: SepaMandatoFormInput) {
    if (nombreTecleado.trim().length < 2) {
      toast.error(tSepa('errors.nombre'))
      return
    }
    // Presencial (modo Dirección): sin trazo (decisión A). Digital: trazo obligatorio.
    if (!modoDireccion && !firma) {
      toast.error(tSepa('errors.firma'))
      return
    }

    startTransition(async () => {
      const body = new FormData()
      body.append('iban', values.iban)
      body.append('titular', values.titular)
      body.append('titular_documento', values.titular_documento)
      body.append('titular_direccion', values.titular_direccion)
      body.append('nombre_tecleado', nombreTecleado.trim())
      // Presencial: sin trazo (el route lo acepta al re-derivar admin del centro).
      body.append('firma_imagen', modoDireccion ? '' : (firma ?? ''))

      let json: RespuestaMandato
      try {
        const res = await fetch(`/${locale}/alta/${ninoId}/mandato-sepa`, {
          method: 'POST',
          body,
        })
        json = (await res.json()) as RespuestaMandato
      } catch {
        toast.error(tSepa('errors.guardado'))
        return
      }

      if (!json.success) {
        toast.error(safeTranslateError(tErrors, json.error ?? 'alta.sepa.errors.guardado'))
        return
      }
      setSubido(true)
      setEnCola(json.pendiente === true)
      setPreviewUrl(
        json.mandato?.id && json.mandato.conDocumento
          ? `/${locale}/mandato-sepa/${json.mandato.id}?origen=alta`
          : null
      )
      toast.success(json.pendiente ? tSepa('pendiente') : tSepa('guardado'))
      onFinalizar()
    })
  }

  // F-2c-2: la familia YA tiene domiciliación activa → INFORMATIVO enmascarado, sin campos ni
  // POST de registro. El mandato de la familia cubre a este niño; solo se finaliza el alta.
  if (mandatoFamilia) {
    const enmascarado = mandatoFamilia.ultimos4
      ? `••••${mandatoFamilia.ultimos4}`
      : tSepa('informativo.sin_ultimos4')
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{tSepa('informativo.intro')}</p>
        <div className="border-success-200 bg-success-50 flex items-start gap-3 rounded-lg border p-4 text-sm">
          <LandmarkIcon className="text-success-700 mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="text-success-800 font-semibold">{tSepa('informativo.titulo')}</p>
            <p className="text-foreground">
              {enmascarado}
              {mandatoFamilia.titular ? (
                <>
                  {' · '}
                  {tSepa('informativo.a_nombre_de', { titular: mandatoFamilia.titular })}
                </>
              ) : null}
            </p>
            <p className="text-muted-foreground text-xs">{tSepa('informativo.nota')}</p>
          </div>
        </div>
        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <Button type="button" onClick={onFinalizar} disabled={pending}>
            {esUltimo ? t('wizard.finalizar') : t('wizard.siguiente')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-muted-foreground text-sm">{tSepa('intro')}</p>

        {subido && (
          <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
            {enCola ? tSepa('pendiente') : tSepa('guardado')}
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                <FileTextIcon className="size-4" aria-hidden />
                {t('documentos.ver')}
              </a>
            )}
          </p>
        )}

        <FormField
          control={form.control}
          name="titular"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tSepa('titular_label')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    onTitularChange(e.target.value)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="titular_documento"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tSepa('documento_label')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    onTitularDocumentoChange(e.target.value)
                  }}
                  autoComplete="off"
                />
              </FormControl>
              <FormDescription>{tSepa('documento_ayuda')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="titular_direccion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tSepa('direccion_label')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    onTitularDireccionChange(e.target.value)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="iban"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tSepa('iban_label')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    onIbanChange(e.target.value)
                  }}
                  placeholder={tSepa('iban_placeholder')}
                  autoComplete="off"
                />
              </FormControl>
              <FormDescription>{tSepa('iban_ayuda')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Texto del mandato SEPA Core (acreedor = centro, adeudo recurrente). */}
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <h3 className="font-semibold">{tSepa('mandato_titulo')}</h3>
          <p className="text-muted-foreground">
            <span className="font-medium">{tSepa('acreedor_titulo')}:</span> {centroNombre}
            {centroDireccion ? ` · ${centroDireccion}` : ''}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium">{tSepa('acreedor_cid_label')}:</span> {centroCid}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium">{tSepa('tipo')}:</span> {tSepa('tipo_recurrente')}
          </p>
          <p className="text-muted-foreground">{tSepa('texto_legal')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nombre_tecleado">{tSepa('nombre_tecleado_label')}</Label>
          <Input
            id="nombre_tecleado"
            value={nombreTecleado}
            onChange={(e) => onNombreTecleadoChange(e.target.value)}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">{tSepa('nombre_tecleado_ayuda')}</p>
        </div>

        <div className="space-y-2">
          <Label>{tSepa('firma_titulo')}</Label>
          {modoDireccion ? (
            // Modo Dirección: sin canvas — mandato firmado en papel (decisión A).
            <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm">
              {tSepa('firma_presencial_aviso')}
            </p>
          ) : (
            <FirmaPad onChange={onFirmaChange} disabled={pending} />
          )}
        </div>

        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onFinalizar} disabled={pending}>
              {tSepa('omitir')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? t('wizard.guardando')
                : esUltimo
                  ? t('wizard.finalizar')
                  : t('wizard.guardar_siguiente')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
