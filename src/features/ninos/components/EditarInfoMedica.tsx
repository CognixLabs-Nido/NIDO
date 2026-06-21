'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'

import { editarInfoMedicaTutor } from '../actions/editar-info-medica-tutor'
import { infoMedicaSchema, type InfoMedicaInput } from '../schemas/nino'

import { InfoMedicaFields } from './InfoMedicaFields'

interface Props {
  ninoId: string
  /** Valores actuales descifrados (para precargar el form) o null si no hay ficha
   *  médica todavía (caso "re-añadir" tras borrado #117). */
  inicial: InfoMedicaInput | null
}

/**
 * F11-F3 — el tutor LEGAL edita o re-añade la info médica de su hijo desde la ficha
 * `/family/nino/[id]`. Modo REPLACE ("lo que se ve es lo que se guarda", incluido vaciar
 * un campo): usa `editarInfoMedicaTutor`. Reusa exactamente los mismos campos que el
 * wizard de alta (`InfoMedicaFields`). Sin re-acuse de confidencialidad (informativo, ya
 * en registro). Al guardar refresca el server component.
 */
export function EditarInfoMedica({ ninoId, inicial }: Props) {
  const t = useTranslations('family.nino.editar_medica')
  const tMed = useTranslations('medico')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const esReanadir = inicial === null

  const form = useForm<InfoMedicaInput>({
    resolver: zodResolver(infoMedicaSchema),
    defaultValues: {
      alergias_graves: inicial?.alergias_graves ?? null,
      notas_emergencia: inicial?.notas_emergencia ?? null,
      medicacion_habitual: inicial?.medicacion_habitual ?? null,
      alergias_leves: inicial?.alergias_leves ?? null,
      medico_familia: inicial?.medico_familia ?? null,
      telefono_emergencia: inicial?.telefono_emergencia ?? null,
    },
  })

  function onSubmit(values: InfoMedicaInput) {
    startTransition(async () => {
      const r = await editarInfoMedicaTutor({ nino_id: ninoId, ...values })
      if (r.success) {
        toast.success(t('guardado'))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={esReanadir ? 'default' : 'ghost'}
        size="xs"
        onClick={() => setOpen(true)}
        data-testid="editar-info-medica-button"
      >
        {esReanadir ? <PlusIcon /> : <PencilIcon />}
        {esReanadir ? t('boton_anadir') : t('boton_editar')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{esReanadir ? t('titulo_anadir') : t('titulo_editar')}</DialogTitle>
            <DialogDescription>{tMed('aviso_cifrado')}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <InfoMedicaFields control={form.control} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('cancelar')}
                </Button>
                <Button type="submit" disabled={pending} data-testid="editar-info-medica-submit">
                  {pending ? t('guardando') : t('guardar')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
