'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FilaFormaGastos } from '@/features/gastos-gestion/components/FilaFormaGastos'
import {
  porContestar,
  type FormaGastos,
  type GastosCurso,
} from '@/features/gastos-gestion/lib/gastos'
import { guardarGastosEnCliente } from '@/features/gastos-gestion/lib/guardar-en-cliente'

interface Props {
  locale: string
  ninoId: string
  /** Los gastos del curso del alta; `null` si no se pudo leer (no se ofrece guardar). */
  gastos: GastosCurso[] | null
  esUltimo: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Fase 9 — el paso de los gastos de gestión del alta: el importe que pide el centro y cómo lo paga
 * la familia, transferencia (con el justificante ahora o después) o efectivo. Contestar es
 * obligatorio para seguir, y la base lo vuelve a exigir al cerrar (`gastos_por_contestar`); que esté
 * cobrado no (D5): lo marca Dirección. Ningún recibo (D6).
 */
export function PasoGastos({ locale, ninoId, gastos, esUltimo, onNext, onBack }: Props) {
  const t = useTranslations('gastos_gestion')
  const tAlta = useTranslations('alta')
  const tErrors = useTranslations()
  const lista = gastos ?? []
  const [formas, setFormas] = useState<Record<string, FormaGastos | null>>(() =>
    Object.fromEntries(lista.map((g) => [g.cursoId, g.forma]))
  )
  const [ficheros, setFicheros] = useState<Record<string, File | null>>({})
  const [intentado, setIntentado] = useState(false)
  const [pending, startTransition] = useTransition()

  const conForma = lista.map((g) => ({ ...g, forma: formas[g.cursoId] ?? null }))
  const completas = porContestar(conForma).length === 0

  function guardar() {
    setIntentado(true)
    if (!completas) {
      toast.error(t('faltan'))
      return
    }
    startTransition(async () => {
      let cola = false
      for (const g of conForma) {
        if (g.forma === null) continue
        const r = await guardarGastosEnCliente({
          locale,
          ninoId,
          cursoId: g.cursoId,
          forma: g.forma,
          justificante: ficheros[g.cursoId] ?? null,
        })
        if (!r.ok) {
          toast.error(tErrors(r.error))
          return
        }
        cola = cola || r.pendienteValidacion
      }
      toast.success(cola ? t('guardado_cola') : t('guardado'))
      onNext()
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('intro')}</p>

      {gastos === null ? (
        <p
          role="alert"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-xl border p-3 text-sm"
        >
          {t('no_leidos')}
        </p>
      ) : (
        <div className="space-y-4">
          {conForma.map((g) => (
            <FilaFormaGastos
              key={g.cursoId}
              locale={locale}
              gastos={g}
              forma={g.forma}
              onForma={(f) => setFormas((prev) => ({ ...prev, [g.cursoId]: f }))}
              onJustificante={(f) => setFicheros((prev) => ({ ...prev, [g.cursoId]: f }))}
              marcarSinContestar={intentado}
              disabled={pending}
            />
          ))}
        </div>
      )}

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {tAlta('wizard.atras')}
        </Button>
        {gastos !== null && (
          <Button type="button" onClick={guardar} disabled={pending}>
            {pending
              ? tAlta('wizard.guardando')
              : esUltimo
                ? tAlta('wizard.finalizar')
                : tAlta('wizard.guardar_siguiente')}
          </Button>
        )}
      </div>
    </div>
  )
}
