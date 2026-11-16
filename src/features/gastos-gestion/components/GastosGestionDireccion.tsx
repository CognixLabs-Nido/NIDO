'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { eurosACentimos, formatEuros } from '@/shared/lib/format-money'

import { fijarImporteNinoGastos, marcarCobroGastos } from '../actions/direccion-gastos'
import { FilaFormaGastos } from './FilaFormaGastos'
import type { FormaGastos, GastosCurso } from '../lib/gastos'
import { guardarGastosEnCliente } from '../lib/guardar-en-cliente'

interface Props {
  locale: string
  ninoId: string
  /** `null` si no se pudo leer: se dice, no se pinta como «no debe nada». */
  gastos: GastosCurso[] | null
  /** El enlace firmado al justificante de cada curso (por `cursoId`), si lo hay. */
  urlsJustificante: Record<string, string | null>
}

/**
 * Fase 9 — lo que ve Dirección de los gastos de gestión del niño, al validar y después: el importe
 * (una propuesta: pone otro o 0), lo que dijo la familia y su justificante, y la marca de cobro. Sin
 * bloqueo ni «exento» (D5) y sin recibo (D6). Puede declarar por la familia (el alta en papel).
 */
export function GastosGestionDireccion({ locale, ninoId, gastos, urlsJustificante }: Props) {
  const t = useTranslations('gastos_gestion')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [importes, setImportes] = useState<Record<string, string>>({})
  const [formas, setFormas] = useState<Record<string, FormaGastos | null>>({})
  const [ficheros, setFicheros] = useState<Record<string, File | null>>({})

  function correr(f: () => Promise<{ success: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await f()
      if (!r.success) toast.error(tErrors(r.error ?? 'gastos_gestion.errors.guardar'))
      else {
        toast.success(t(okMsg))
        router.refresh()
      }
    })
  }

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
            const url = urlsJustificante[g.cursoId] ?? null
            const forma = formas[g.cursoId] ?? g.forma
            return (
              <div key={g.cursoId} className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-semibold">{t('curso', { curso: g.cursoNombre })}</p>
                <p className="text-sm">
                  {g.importePropio
                    ? t('importe_propio', {
                        importe: formatEuros(g.importe, locale),
                        curso: formatEuros(g.importeCurso, locale),
                      })
                    : t('importe', { importe: formatEuros(g.importe, locale) })}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">
                    <span className="text-muted-foreground block text-xs">{t('otro_importe')}</span>
                    <Input
                      inputMode="decimal"
                      className="w-32"
                      value={importes[g.cursoId] ?? ''}
                      onChange={(e) => setImportes((p) => ({ ...p, [g.cursoId]: e.target.value }))}
                      disabled={pending}
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !(importes[g.cursoId] ?? '').trim()}
                    onClick={() => {
                      const c = eurosACentimos(
                        Number((importes[g.cursoId] ?? '').replace(',', '.'))
                      )
                      if (!Number.isFinite(c) || c < 0) {
                        toast.error(tErrors('gastos_gestion.errors.importe'))
                        return
                      }
                      correr(
                        () =>
                          fijarImporteNinoGastos({
                            nino_id: ninoId,
                            curso_academico_id: g.cursoId,
                            importe_centimos: c,
                          }),
                        'importe_guardado'
                      )
                    }}
                  >
                    {t('guardar_importe')}
                  </Button>
                  {g.importePropio && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        correr(
                          () =>
                            fijarImporteNinoGastos({
                              nino_id: ninoId,
                              curso_academico_id: g.cursoId,
                              importe_centimos: null,
                            }),
                          'importe_guardado'
                        )
                      }
                    >
                      {t('volver_al_del_curso')}
                    </Button>
                  )}
                </div>

                <p className="text-sm">
                  {g.forma ? t('dijo', { forma: t(`forma.${g.forma}`) }) : t('sin_contestar_aun')}
                  {url && (
                    <>
                      {' · '}
                      <a href={url} target="_blank" rel="noreferrer" className="underline">
                        {t('ver_justificante')}
                      </a>
                    </>
                  )}
                </p>

                <FilaFormaGastos
                  locale={locale}
                  gastos={g}
                  forma={forma}
                  onForma={(f) => setFormas((p) => ({ ...p, [g.cursoId]: f }))}
                  onJustificante={(f) => setFicheros((p) => ({ ...p, [g.cursoId]: f }))}
                  disabled={pending}
                />
                {forma && (forma !== g.forma || ficheros[g.cursoId]) && (
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
                          forma,
                          justificante: ficheros[g.cursoId] ?? null,
                        })
                        if (!r.ok) toast.error(tErrors(r.error))
                        else {
                          toast.success(t('guardado'))
                          router.refresh()
                        }
                      })
                    }
                  >
                    {t('guardar_forma')}
                  </Button>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-sm">
                    {g.cobradoAt
                      ? t('cobrado_el', {
                          fecha: new Date(g.cobradoAt).toLocaleDateString(locale, {
                            timeZone: 'Europe/Madrid',
                          }),
                        })
                      : t('sin_cobrar')}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={g.cobradoAt ? 'ghost' : 'default'}
                    disabled={pending}
                    onClick={() =>
                      correr(
                        () =>
                          marcarCobroGastos({
                            nino_id: ninoId,
                            curso_academico_id: g.cursoId,
                            cobrado: !g.cobradoAt,
                          }),
                        g.cobradoAt ? 'desmarcado' : 'marcado'
                      )
                    }
                  >
                    {g.cobradoAt ? t('desmarcar_cobro') : t('marcar_cobro')}
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
