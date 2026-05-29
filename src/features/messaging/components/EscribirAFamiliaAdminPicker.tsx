'use client'

import { MessageCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { VinculoTutorMin } from '../queries/get-vinculos-tutores-aula'

interface Props {
  /** Id del niño asociado al botón. No se transmite a la URL del SplitView
   *  (el flujo admin↔familia es per-tutor, no per-niño), se conserva por
   *  simetría con el botón profe + posible telemetría futura. */
  ninoId: string
  vinculos: VinculoTutorMin[]
  locale: string
}

/**
 * F5B-#33 — Sustituto admin del Link "Escribir a la familia" que vive en
 * `NinoAgendaCard` (vista de aula). Discrimina por número de tutores
 * relevantes con vínculo activo sobre el niño:
 *
 *  - 0 tutores: botón presente pero deshabilitado (`aria-disabled`,
 *    sin `href`) con texto `picker_sin_tutores` en sr-only. No oculto
 *    para mantener la posición visual y comunicar el motivo.
 *  - 1 tutor: `<Link>` directo a
 *    `/messages?tab=direccion&tutor=<usuario_id>` con el tutor de
 *    mayor prioridad (`tutor_legal_principal > secundario > autorizado`).
 *  - ≥2 tutores: `<Dialog>` con la lista ordenada (principal arriba),
 *    badge `tipo_vinculo` por fila. Click navega y cierra el dialog.
 *
 * Estilo CSS pensado para encajar bit-a-bit en el slot del Link actual
 * de `NinoAgendaCard`: misma altura, mismos paddings, `border-l`. El
 * `data-testid="escribir-familia-button"` se conserva para reusar los
 * tests E2E existentes que esperaban el botón profe en la misma
 * posición — los E2E reales no saben que la URL destino cambió.
 *
 * NO recibe `ninoId` en la URL final (el SplitView del PR #32 admite
 * `?tab=direccion&tutor=<id>`, no acepta `?nino=` en ese tab); la prop
 * se conserva por simetría / telemetría.
 *
 * Para profe, este componente NO se renderiza — `NinoAgendaCard`
 * mantiene el `<Link>` legacy en su branch profe.
 */
export function EscribirAFamiliaAdminPicker({ ninoId: _ninoId, vinculos, locale }: Props) {
  const t = useTranslations('messages.admin_direccion')
  const tFicha = useTranslations('messages.ficha_nino')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Orden: peso del tipo de vínculo (principal=0, secundario=1,
  // autorizado=2), luego alfabético. Sort estable.
  const ordenados = useMemo(() => [...vinculos].sort(comparar), [vinculos])

  // Clases visuales pensadas para sustituir bit-a-bit el slot del Link
  // legacy de NinoAgendaCard. Cambios en esa card requieren reflejarlos
  // aquí (acoplamiento UI deliberado).
  const wrapperClass =
    'border-border text-muted-foreground hover:bg-muted hover:text-foreground flex shrink-0 items-center gap-1 border-l px-3 text-xs font-medium transition-colors'

  // Caso 0: botón sin acción. Mantenemos elemento Link visualmente
  // idéntico pero con aria-disabled y sin href. tabindex=-1 lo saca del
  // tab order; el screen reader anuncia el motivo vía sr-only.
  if (ordenados.length === 0) {
    return (
      <span
        role="link"
        aria-disabled="true"
        tabIndex={-1}
        className={cn(wrapperClass, 'cursor-not-allowed opacity-60')}
        data-testid="escribir-familia-button"
      >
        <MessageCircleIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">{tFicha('escribir_familia')}</span>
        <span className="sr-only">{t('picker_sin_tutores')}</span>
      </span>
    )
  }

  // Caso 1: Link directo. Sin Dialog.
  if (ordenados.length === 1) {
    const t1 = ordenados[0]!
    return (
      <Link
        href={`/${locale}/messages?tab=direccion&tutor=${t1.usuario_id}`}
        className={wrapperClass}
        aria-label={tFicha('escribir_familia')}
        data-testid="escribir-familia-button"
      >
        <MessageCircleIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">{tFicha('escribir_familia')}</span>
      </Link>
    )
  }

  // Caso N: Dialog con la lista. El trigger reutiliza el mismo aspecto.
  // El render prop fusiona props del trigger sobre un `<button>` con la
  // misma apariencia que el Link de los otros casos (no abre URL, abre
  // el modal).
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={wrapperClass}
            aria-label={tFicha('escribir_familia')}
            data-testid="escribir-familia-button"
          >
            <MessageCircleIcon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{tFicha('escribir_familia')}</span>
          </button>
        }
      />

      <DialogContent data-testid="picker-tutor-dialog">
        <DialogHeader>
          <DialogTitle>{t('picker_titulo')}</DialogTitle>
          <DialogDescription>{t('picker_descripcion')}</DialogDescription>
        </DialogHeader>
        <ul className="divide-border divide-y">
          {ordenados.map((v) => (
            <li key={v.usuario_id}>
              <button
                type="button"
                onClick={() => {
                  router.push(`/${locale}/messages?tab=direccion&tutor=${v.usuario_id}`)
                  setOpen(false)
                }}
                className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-2 py-3 text-left transition-colors"
                data-testid={`picker-tutor-item-${v.usuario_id}`}
              >
                <span className="text-foreground truncate text-sm font-medium">
                  {v.nombre_completo}
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {tipoLabel(v.tipo_vinculo, t)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('picker_cancelar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function pesoTipoVinculo(t: VinculoTutorMin['tipo_vinculo']): number {
  if (t === 'tutor_legal_principal') return 0
  if (t === 'tutor_legal_secundario') return 1
  return 2
}

function comparar(a: VinculoTutorMin, b: VinculoTutorMin): number {
  const pa = pesoTipoVinculo(a.tipo_vinculo)
  const pb = pesoTipoVinculo(b.tipo_vinculo)
  if (pa !== pb) return pa - pb
  return a.nombre_completo.localeCompare(b.nombre_completo)
}

function tipoLabel(
  tipo: VinculoTutorMin['tipo_vinculo'],
  t: ReturnType<typeof useTranslations>
): string {
  if (tipo === 'tutor_legal_principal') return t('picker_tipo_principal')
  if (tipo === 'tutor_legal_secundario') return t('picker_tipo_secundario')
  return t('picker_tipo_autorizado')
}
