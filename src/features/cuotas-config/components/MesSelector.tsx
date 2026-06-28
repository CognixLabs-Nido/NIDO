'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  anio: number
  mes: number
}

// Selector de año/mes. Empuja los searchParams (?anio&mes&tab=asignacion) para que la
// página recargue la configuración del mes en el servidor (RLS-safe, sin fetch cliente).
export function MesSelector({ anio, mes }: Props) {
  const t = useTranslations('admin.cuotas')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const anios = [anio - 1, anio, anio + 1]
  const anioItems = anios.map((a) => ({ value: String(a), label: String(a) }))
  const mesItems = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const label = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2000, i, 1))
    return { value: String(m), label: label.charAt(0).toUpperCase() + label.slice(1) }
  })

  function navegar(nextAnio: number, nextMes: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'asignacion')
    params.set('anio', String(nextAnio))
    params.set('mes', String(nextMes))
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <span className="text-muted-foreground text-sm">{t('periodo')}</span>
      <Select items={mesItems} value={String(mes)} onValueChange={(v) => navegar(anio, Number(v))}>
        <SelectTrigger size="sm" aria-label={t('mes')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mesItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={anioItems} value={String(anio)} onValueChange={(v) => navegar(Number(v), mes)}>
        <SelectTrigger size="sm" aria-label={t('anio')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {anioItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
