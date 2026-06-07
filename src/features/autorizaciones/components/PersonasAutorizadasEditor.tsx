'use client'

import { Trash2Icon, UserPlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { PersonaAutorizada } from '../types'

interface Props {
  value: PersonaAutorizada[]
  onChange: (personas: PersonaAutorizada[]) => void
  disabled?: boolean
}

/**
 * Editor de la lista de personas autorizadas a recoger (recogida, F8-2). Filas
 * nombre + DNI (laxo) + parentesco. La lista se firma y se ata al hash. Reutiliza
 * los inputs base; no conoce el flujo de firma (lo orquesta el panel).
 */
export function PersonasAutorizadasEditor({ value, onChange, disabled }: Props) {
  const t = useTranslations('autorizaciones')

  function actualizar(i: number, campo: keyof PersonaAutorizada, v: string) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, [campo]: v } : p)))
  }
  function anadir() {
    onChange([...value, { nombre: '', dni: '', parentesco: '' }])
  }
  function quitar(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      <Label>{t('recogida.lista')}</Label>
      {value.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('recogida.lista_vacia')}</p>
      )}
      <ul className="space-y-3">
        {value.map((p, i) => (
          <li
            key={i}
            className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <Input
              value={p.nombre}
              onChange={(e) => actualizar(i, 'nombre', e.target.value)}
              placeholder={t('recogida.nombre')}
              maxLength={200}
              disabled={disabled}
              aria-label={t('recogida.nombre')}
            />
            <Input
              value={p.dni}
              onChange={(e) => actualizar(i, 'dni', e.target.value)}
              placeholder={t('recogida.dni')}
              maxLength={20}
              disabled={disabled}
              aria-label={t('recogida.dni')}
            />
            <Input
              value={p.parentesco ?? ''}
              onChange={(e) => actualizar(i, 'parentesco', e.target.value)}
              placeholder={t('recogida.parentesco')}
              maxLength={100}
              disabled={disabled}
              aria-label={t('recogida.parentesco')}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => quitar(i)}
              disabled={disabled}
              aria-label={t('recogida.quitar')}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={anadir} disabled={disabled}>
        <UserPlusIcon className="mr-1 size-4" />
        {t('recogida.anadir')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('recogida.dni_aviso')}</p>
    </div>
  )
}
