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
import { sepaMandatoFormSchema, type SepaMandatoFormInput } from '@/features/alta/schemas/sepa'
import { safeTranslateError } from '@/shared/lib/safe-translate'

interface RespuestaMandato {
  success: boolean
  error?: string
  /** 2026-11-20: con la familia ya validada, el mandato espera a Dirección en la cola. */
  pendiente?: boolean
  mandato?: { identificador: string; id: string | null }
}

/**
 * F-2c-4 — diálogo del TUTOR (en `/family/recibos`) para REGISTRAR (1er mandato) o SUSTITUIR su
 * domiciliación SEPA con firma DIGITAL completa: IBAN + titular (con su documento y su dirección,
 * 0c-2) + nombre tecleado + trazo
 * (`FirmaPad`). Manda los datos y el trazo a `/family/domiciliacion`; desde el 2026-11-22 el PDF lo
 * compone el SERVIDOR, que lo sella y decide registrar, sustituir o proponer (cierre del mandato,
 * `docs/specs/mandato-sepa-cierre.md`).
 */
export function DomiciliacionTutorDialog({
  locale,
  centroId,
  centroNombre,
  centroDireccion,
  centroCid,
  titularInicial,
  trigger,
}: {
  locale: string
  centroId: string
  centroNombre: string
  centroDireccion: string
  /** El CID del centro (0c-2): sin él la página no ofrece este diálogo. */
  centroCid: string
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
    defaultValues: {
      iban: '',
      titular: titularInicial ?? '',
      titular_documento: '',
      titular_direccion: '',
    },
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
      const body = new FormData()
      // El centro de la página: la ruta busca la familia del tutor EN ese centro.
      body.append('centro_id', centroId)
      body.append('iban', values.iban)
      body.append('titular', values.titular)
      body.append('titular_documento', values.titular_documento)
      body.append('titular_direccion', values.titular_direccion)
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
        toast.error(
          safeTranslateError(tErrors, json.error ?? 'family.domiciliacion.errors.guardado')
        )
        return
      }
      toast.success(json.pendiente ? tSepa('pendiente') : t('guardado'))
      setOpen(false)
      setFirma(null)
      setNombreTecleado('')
      form.reset({
        iban: '',
        titular: values.titular,
        titular_documento: values.titular_documento,
        titular_direccion: values.titular_direccion,
      })
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
              name="titular_documento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tSepa('documento_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={40} autoComplete="off" />
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
                    <Input {...field} maxLength={300} />
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
              <p className="text-muted-foreground">
                <span className="font-medium">{tSepa('acreedor_cid_label')}:</span> {centroCid}
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
