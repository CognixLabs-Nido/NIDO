'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

import { CheckCircle2Icon, FileTextIcon } from 'lucide-react'
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
  /** Titular sugerido (nombre del tutor 1). */
  titularSugerido: string
  /** Id del tutor 1 (firmante/titular) para el identificador del mandato. */
  currentUserId: string
  inicial: MandatoSepaInicial | null
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
  titularSugerido,
  currentUserId,
  inicial,
  onFinalizar,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tSepa = useTranslations('alta.sepa')
  const tErrors = useTranslations()
  const [firma, setFirma] = useState<string | null>(null)
  const [nombreTecleado, setNombreTecleado] = useState<string>(inicial?.titular ?? titularSugerido)
  const [subido, setSubido] = useState<boolean>(Boolean(inicial))
  const [previewUrl, setPreviewUrl] = useState<string | null>(inicial?.documentoUrl ?? null)
  const [pending, startTransition] = useTransition()

  const form = useForm<SepaMandatoFormInput>({
    resolver: zodResolver(sepaMandatoFormSchema),
    defaultValues: {
      // El IBAN cifrado en reposo no se pre-rellena (G-2bis): re-editar = reintroducirlo.
      iban: '',
      titular: inicial?.titular ?? titularSugerido,
    },
  })

  function onSubmit(values: SepaMandatoFormInput) {
    if (nombreTecleado.trim().length < 2) {
      toast.error(tSepa('errors.nombre'))
      return
    }
    if (!firma) {
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
          firmaDataUrl: firma,
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
      body.append('firma_imagen', firma)

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
                <Input {...field} />
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
                <Input {...field} placeholder={tSepa('iban_placeholder')} autoComplete="off" />
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
            onChange={(e) => setNombreTecleado(e.target.value)}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">{tSepa('nombre_tecleado_ayuda')}</p>
        </div>

        <div className="space-y-2">
          <Label>{tSepa('firma_titulo')}</Label>
          <FirmaPad onChange={setFirma} disabled={pending} />
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
