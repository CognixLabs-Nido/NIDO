'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { FilaFormaGastos } from './FilaFormaGastos'
import type { FormaGastos, GastosCurso } from '../lib/gastos'
import { guardarGastosEnCliente } from '../lib/guardar-en-cliente'

interface Props {
  locale: string
  ninoId: string
  /** `null` si no se pudo leer: se dice. */
  gastos: GastosCurso[] | null
}

/**
 * Fase 9 — los gastos de gestión del alta en la ficha del niño, para la familia (tutor legal): lo que
 * dijo y si está cobrado; y, si en el alta no tenía el justificante a mano, subirlo después. Con el
 * alta validada va a la cola y Dirección lo aprueba (la base decide; la app encola cuando lo dice).
 */
export function GastosGestionFamilia({ locale, ninoId, gastos }: Props) {
  const t = useTranslations('gastos_gestion')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [formas, setFormas] = useState<Record<string, FormaGastos | null>>({})
  const [ficheros, setFicheros] = useState<Record<string, File | null>>({})

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('titulo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {gastos === null ? (
          <p role="alert" className="text-accent-warm-800 text-sm">
            {t('no_leidos')}
          </p>
        ) : (
          gastos.map((g) => {
            const forma = formas[g.cursoId] ?? g.forma
            const cambia = forma !== null && (forma !== g.forma || Boolean(ficheros[g.cursoId]))
            return (
              <div key={g.cursoId} className="space-y-2">
                <p className="text-sm">
                  {g.cobradoAt ? t('cobrado') : t('sin_cobrar')}
                  {g.justificantePath && ` · ${t('justificante_ya')}`}
                </p>
                <FilaFormaGastos
                  locale={locale}
                  gastos={g}
                  forma={forma}
                  onForma={(f) => setFormas((p) => ({ ...p, [g.cursoId]: f }))}
                  onJustificante={(f) => setFicheros((p) => ({ ...p, [g.cursoId]: f }))}
                  disabled={pending || g.cobradoAt !== null}
                />
                {cambia && g.cobradoAt === null && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await guardarGastosEnCliente({
                          locale,
                          ninoId,
                          cursoId: g.cursoId,
                          forma: forma as FormaGastos,
                          justificante: ficheros[g.cursoId] ?? null,
                        })
                        if (!r.ok) {
                          toast.error(tErrors(r.error))
                          return
                        }
                        toast.success(r.pendienteValidacion ? t('guardado_cola') : t('guardado'))
                        router.refresh()
                      })
                    }
                  >
                    {t('guardar_forma')}
                  </Button>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
