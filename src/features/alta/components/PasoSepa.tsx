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

import { generarMandatoPdf } from '../lib/mandato-pdf'
import { generarIdentificadorMandato } from '../lib/mandato-sepa'
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
  mandato?: { identificador: string; documento: { path: string; url: string | null } }
}

interface Props {
  locale: string
  ninoId: string
  centroId: string
  centroNombre: string
  centroDireccion: string
  /** Id del tutor 1 (firmante/titular) para el identificador del mandato. */
  currentUserId: string
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
  nombreTecleado: string
  onNombreTecleadoChange: (v: string) => void
  /** PR-3b-2 · B2: modo Dirección → mandato PRESENCIAL (sin trazo; PDF con nota "en papel"). */
  modoDireccion?: boolean
  /** Último paso: al guardar (o al omitir) se finaliza el alta. */
  onFinalizar: () => void
  onBack: () => void
}

/**
 * Paso 8 del alta (F11-G-2) — IBAN + mandato SEPA Core. El tutor 1 (titular) introduce el
 * IBAN (validado por estructura y dígitos de control), revisa el texto del mandato (acreedor
 * = centro, adeudo recurrente) y firma con trazo (`FirmaPad`). El cliente genera el PDF del
 * mandato (jsPDF) con la firma embebida y un identificador único `NIDO-…`, y lo envía a la
 * ruta de subida, que persiste `mandatos_sepa` (service-role tras authz). Es el último paso:
 * al guardar el mandato — o al omitirlo — se finaliza el alta.
 */
export function PasoSepa({
  locale,
  ninoId,
  centroId,
  centroNombre,
  centroDireccion,
  currentUserId,
  inicial,
  mandatoFamilia,
  firma,
  onFirmaChange,
  iban,
  onIbanChange,
  titular,
  onTitularChange,
  nombreTecleado,
  onNombreTecleadoChange,
  modoDireccion = false,
  onFinalizar,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tSepa = useTranslations('alta.sepa')
  const tErrors = useTranslations()
  const [subido, setSubido] = useState<boolean>(Boolean(inicial))
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
      const identificador = generarIdentificadorMandato(centroId, currentUserId, Date.now())
      const fechaLegible = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date())

      let pdf: Blob
      try {
        pdf = generarMandatoPdf({
          identificadorMandato: identificador,
          iban: values.iban,
          titular: values.titular,
          acreedorNombre: centroNombre,
          acreedorDireccion: centroDireccion,
          firmaDataUrl: modoDireccion ? null : firma,
          firmaPresencialNota: modoDireccion ? tSepa('firma_presencial_nota') : undefined,
          fechaLegible,
          textoLegal: tSepa('texto_legal'),
          labels: {
            titulo: tSepa('pdf.titulo'),
            acreedorTitulo: tSepa('acreedor_titulo'),
            deudorTitulo: tSepa('deudor_titulo'),
            referencia: tSepa('referencia'),
            tipo: tSepa('tipo'),
            tipoRecurrente: tSepa('tipo_recurrente'),
            iban: tSepa('iban_label'),
            titular: tSepa('titular_label'),
            firma: tSepa('firma_titulo'),
            fecha: tSepa('fecha'),
          },
        })
      } catch {
        toast.error(tSepa('errors.guardado'))
        return
      }

      const body = new FormData()
      body.append('file', new File([pdf], 'mandato-sepa.pdf', { type: 'application/pdf' }))
      body.append('iban', values.iban)
      body.append('titular', values.titular)
      body.append('identificador_mandato', identificador)
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
      setPreviewUrl(json.mandato?.documento.url ?? null)
      toast.success(tSepa('guardado'))
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
            {t('wizard.finalizar')}
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
            {tSepa('guardado')}
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
              {pending ? t('wizard.guardando') : t('wizard.finalizar')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
