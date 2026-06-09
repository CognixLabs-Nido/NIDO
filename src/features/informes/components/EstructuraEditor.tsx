'use client'

import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { AreaInforme } from '../types'

/** Genera un id estable para un ítem nuevo (browser crypto). */
function nuevoId(): string {
  return globalThis.crypto.randomUUID()
}

function mover<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const next = arr.slice()
  const [el] = next.splice(from, 1)
  next.splice(to, 0, el!)
  return next
}

/**
 * Editor controlado de la estructura áreas→ítems de una plantilla de informe.
 * La escala es FIJA para todos los ítems (no se configura por ítem); aquí solo se
 * teclea el texto del área y de cada ítem (en castellano). Reordenar = subir/bajar.
 */
export function EstructuraEditor({
  value,
  onChange,
}: {
  value: AreaInforme[]
  onChange: (next: AreaInforme[]) => void
}) {
  const t = useTranslations('informes')

  function addArea() {
    onChange([...value, { titulo: '', items: [{ id: nuevoId(), texto: '' }] }])
  }
  function removeArea(ai: number) {
    onChange(value.filter((_, i) => i !== ai))
  }
  function moveArea(ai: number, dir: -1 | 1) {
    onChange(mover(value, ai, ai + dir))
  }
  function setAreaTitulo(ai: number, titulo: string) {
    onChange(value.map((a, i) => (i === ai ? { ...a, titulo } : a)))
  }
  function addItem(ai: number) {
    onChange(
      value.map((a, i) =>
        i === ai ? { ...a, items: [...a.items, { id: nuevoId(), texto: '' }] } : a
      )
    )
  }
  function removeItem(ai: number, ii: number) {
    onChange(
      value.map((a, i) => (i === ai ? { ...a, items: a.items.filter((_, j) => j !== ii) } : a))
    )
  }
  function moveItem(ai: number, ii: number, dir: -1 | 1) {
    onChange(value.map((a, i) => (i === ai ? { ...a, items: mover(a.items, ii, ii + dir) } : a)))
  }
  function setItemTexto(ai: number, ii: number, texto: string) {
    onChange(
      value.map((a, i) =>
        i === ai ? { ...a, items: a.items.map((it, j) => (j === ii ? { ...it, texto } : it)) } : a
      )
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>{t('form.estructura')}</Label>
        <Button type="button" variant="outline" size="sm" onClick={addArea}>
          <PlusIcon className="mr-1 size-4" />
          {t('form.anadir_area')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('form.escala_nota')}</p>

      {value.length === 0 && <p className="text-muted-foreground text-sm">{t('form.sin_areas')}</p>}

      <div className="space-y-4">
        {value.map((area, ai) => (
          <div key={ai} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`area-${ai}`}>{t('form.area_titulo')}</Label>
                <Input
                  id={`area-${ai}`}
                  value={area.titulo}
                  onChange={(e) => setAreaTitulo(ai, e.target.value)}
                  maxLength={200}
                  placeholder={t('form.area_titulo_placeholder')}
                />
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('form.subir')}
                  disabled={ai === 0}
                  onClick={() => moveArea(ai, -1)}
                >
                  <ChevronUpIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('form.bajar')}
                  disabled={ai === value.length - 1}
                  onClick={() => moveArea(ai, 1)}
                >
                  <ChevronDownIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('form.quitar')}
                  onClick={() => removeArea(ai)}
                >
                  <Trash2Icon className="text-destructive size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2 pl-1">
              {area.items.map((item, ii) => (
                <div key={item.id} className="flex items-center gap-2">
                  <Input
                    value={item.texto}
                    onChange={(e) => setItemTexto(ai, ii, e.target.value)}
                    maxLength={500}
                    placeholder={t('form.item_texto_placeholder')}
                    aria-label={t('form.item_texto_placeholder')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('form.subir')}
                    disabled={ii === 0}
                    onClick={() => moveItem(ai, ii, -1)}
                  >
                    <ChevronUpIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('form.bajar')}
                    disabled={ii === area.items.length - 1}
                    onClick={() => moveItem(ai, ii, 1)}
                  >
                    <ChevronDownIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('form.quitar')}
                    onClick={() => removeItem(ai, ii)}
                  >
                    <Trash2Icon className="text-destructive size-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addItem(ai)}>
                <PlusIcon className="mr-1 size-4" />
                {t('form.anadir_item')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
