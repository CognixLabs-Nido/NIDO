'use client'

import { useTranslations } from 'next-intl'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import type { MenuDiaInput } from '../schemas/menu'

interface Props {
  open: boolean
  fecha: Date | null
  /** Valores actuales del menu_dia (dirty o persistido). */
  values: Omit<MenuDiaInput, 'fecha'>
  locale: 'es' | 'en' | 'va'
  onChange: (campo: keyof Omit<MenuDiaInput, 'fecha'>, valor: string | null) => void
  onClose: () => void
  /** "Hecho" — marca el día como dirty en el editor padre y cierra. No persiste. */
  onDone: () => void
}

/**
 * Dialog modal con los 6 campos del menu_dia para el día seleccionado.
 * Es controlado: el editor padre mantiene el estado dirty y persiste en
 * batch al pulsar "Guardar mes".
 */
export function PanelEdicionMenuDia({
  open,
  fecha,
  values,
  locale,
  onChange,
  onClose,
  onDone,
}: Props) {
  const t = useTranslations('menus.editor.panel_dia')

  const fechaTxt = fecha
    ? new Intl.DateTimeFormat(locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES', {
        dateStyle: 'full',
      }).format(fecha)
    : ''

  const handle =
    (campo: keyof Omit<MenuDiaInput, 'fecha'>) => (e: { target: { value: string } }) => {
      const v = e.target.value
      onChange(campo, v.trim() === '' ? null : v)
    }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('title', { fecha: fechaTxt })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field
            id="dia-desayuno"
            label={t('desayuno')}
            value={values.desayuno}
            onChange={handle('desayuno')}
          />
          <Field
            id="dia-media-manana"
            label={t('media_manana')}
            value={values.media_manana}
            onChange={handle('media_manana')}
          />
          <div className="bg-muted/40 border-border/60 grid gap-2 rounded-lg border p-2">
            <h4 className="text-foreground text-xs font-semibold uppercase">{t('comida')}</h4>
            <Field
              id="dia-comida-primero"
              label={t('comida_primero')}
              value={values.comida_primero}
              onChange={handle('comida_primero')}
            />
            <Field
              id="dia-comida-segundo"
              label={t('comida_segundo')}
              value={values.comida_segundo}
              onChange={handle('comida_segundo')}
            />
            <Field
              id="dia-comida-postre"
              label={t('comida_postre')}
              value={values.comida_postre}
              onChange={handle('comida_postre')}
            />
          </div>
          <Field
            id="dia-merienda"
            label={t('merienda')}
            value={values.merienda}
            onChange={handle('merienda')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancelar')}
            </Button>
            <Button type="button" onClick={onDone} data-testid="menu-dia-hecho">
              {t('hecho')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  onChange: (e: { target: { value: string } }) => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={id}
        rows={2}
        maxLength={300}
        value={value ?? ''}
        onChange={onChange}
        data-testid={`menu-dia-input-${id}`}
      />
    </div>
  )
}
