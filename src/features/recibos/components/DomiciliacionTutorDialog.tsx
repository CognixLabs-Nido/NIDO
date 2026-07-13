'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
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
import { generarMandatoPdf } from '@/features/alta/lib/mandato-pdf'
import { generarIdentificadorMandato } from '@/features/alta/lib/mandato-sepa'
import { sepaMandatoFormSchema, type SepaMandatoFormInput } from '@/features/alta/schemas/sepa'
import { safeTranslateError } from '@/shared/lib/safe-translate'

interface RespuestaMandato {
  success: boolean
  error?: string
  mandato?: { identificador: string; documento: { path: string; url: string | null } }
}

/**
 * F-2c-4 — diálogo del TUTOR (en `/family/recibos`) para REGISTRAR (1er mandato) o SUSTITUIR su
 * domiciliación SEPA con firma DIGITAL completa: IBAN + titular + nombre tecleado + trazo
 * (`FirmaPad`). Reutiliza la maquinaria del paso 8 del alta: genera el PDF con `generarMandatoPdf`
 * (jsPDF) con la firma embebida y un identificador `NIDO-…`, y lo envía en FormData al route
 * `/family/domiciliacion`, que resuelve la familia server-side, sube el PDF familia-scoped, calcula
 * el `texto_hash` y decide registrar vs sustituir. La i18n del PDF (rótulos + texto legal) se reusa
 * de `alta.sepa`; la del diálogo, de `family.domiciliacion`.
 */
export function DomiciliacionTutorDialog({
  locale,
  centroId,
  centroNombre,
  centroDireccion,
  currentUserId,
  titularInicial,
  trigger,
}: {
  locale: string
  centroId: string
  centroNombre: string
  centroDireccion: string
  /** Tutor logueado (firmante) — para el identificador del mandato. */
  currentUserId: string
  /** Prefill del titular (el actual, al sustituir); vacío al registrar el 1º. */
  titularInicial?: string | null
  trigger: ReactElement
}) {
  const t = useTranslations('family.domiciliacion')
  const tSepa = useTranslations('alta.sepa')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [nombreTecleado, setNombreTecleado] = useState('')
  const [pending, startTransition] = useTransition()

  const form = useForm<SepaMandatoFormInput>({
    resolver: zodResolver(sepaMandatoFormSchema),
    defaultValues: { iban: '', titular: titularInicial ?? '' },
  })

  function onSubmit(values: SepaMandatoFormInput) {
    if (nombreTecleado.trim().length < 2) {
      toast.error(t('validation.nombre'))
      return
    }
    if (!firma) {
      toast.error(t('validation.firma'))
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
        toast.error(t('errors.guardado'))
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
        const res = await fetch(`/${locale}/family/domiciliacion`, { method: 'POST', body })
        json = (await res.json()) as RespuestaMandato
      } catch {
        toast.error(t('errors.guardado'))
        return
      }

      if (!json.success) {
        toast.error(safeTranslateError(tErrors, json.error ?? 'family.domiciliacion.errors.guardado'))
        return
      }
      toast.success(t('guardado'))
      setOpen(false)
      setFirma(null)
      setNombreTecleado('')
      form.reset({ iban: '', titular: values.titular })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog_titulo')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <p className="text-muted-foreground text-sm">{t('dialog_intro')}</p>
            <FormField
              control={form.control}
              name="titular"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('titular')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={140} />
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
                  <FormLabel>{t('iban')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ES00 0000 0000 0000 0000 0000"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormDescription>{t('iban_ayuda')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Texto del mandato SEPA Core (acreedor = centro, adeudo recurrente). */}
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium">{tSepa('acreedor_titulo')}:</span> {centroNombre}
                {centroDireccion ? ` · ${centroDireccion}` : ''}
              </p>
              <p className="text-muted-foreground">{tSepa('texto_legal')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nombre_tecleado_dom">{t('nombre_tecleado')}</Label>
              <Input
                id="nombre_tecleado_dom"
                value={nombreTecleado}
                onChange={(e) => setNombreTecleado(e.target.value)}
                autoComplete="off"
                maxLength={140}
              />
              <p className="text-muted-foreground text-xs">{t('nombre_tecleado_ayuda')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('firma')}</Label>
              <FirmaPad onChange={setFirma} disabled={pending} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('guardando') : t('confirmar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
