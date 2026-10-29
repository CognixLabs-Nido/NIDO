'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { verDatosBloqueados } from '../actions/ver-datos-bloqueados'
import { renderDatosBloqueadosHtml } from '../lib/render-datos-bloqueados'
import {
  APARTADOS,
  MOTIVO_MAX,
  MOTIVO_MIN,
  MOTIVOS_TIPO,
  type ContenidoBloqueado,
  type MotivoTipo,
} from '../types'

/**
 * Lo bloqueado de un sujeto, para la titular. Nada se ve sin el motivo: la BD lo exige y deja una
 * fila por cada vista y cada descarga. La descarga vuelve a pedirlo a la BD (y deja su fila): no se
 * descarga lo que se tiene en pantalla.
 */
export function VerDatosBloqueados({
  centroId,
  sujetoTipo,
  sujetoId,
  sujeto,
}: {
  centroId: string
  sujetoTipo: 'nino' | 'usuario'
  sujetoId: string
  sujeto: string
}) {
  const t = useTranslations('datos_bloqueados')
  const tTodo = useTranslations()
  const [motivoTipo, setMotivoTipo] = useState<MotivoTipo | ''>('')
  const [motivo, setMotivo] = useState('')
  const [contenido, setContenido] = useState<ContenidoBloqueado | null>(null)
  const [pending, startTransition] = useTransition()
  const valido = motivoTipo !== '' && motivo.trim().length >= MOTIVO_MIN

  function pedir(accion: 'ver' | 'descargar') {
    if (!valido) return
    startTransition(async () => {
      const r = await verDatosBloqueados({
        centroId,
        sujetoTipo,
        sujetoId,
        motivoTipo,
        motivo,
        accion,
      })
      if (!r.success) {
        toast.error(tTodo(r.error))
        return
      }
      if (accion === 'ver') {
        setContenido(r.data)
        return
      }
      const generadoEn = new Date().toISOString()
      const html = renderDatosBloqueadosHtml(
        r.data,
        { sujeto, motivo: `${t(`motivos.${motivoTipo}`)} · ${motivo.trim()}`, generadoEn },
        {
          titulo: t('html.titulo'),
          sujeto: t('html.sujeto'),
          motivo: t('html.motivo'),
          generado: t('html.generado'),
          bloqueadoDesde: t('html.bloqueado_desde'),
          sinFilas: t('sin_filas'),
          apartados: Object.fromEntries(APARTADOS.map((a) => [a, t(`apartados.${a}`)])),
        }
      )
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `nido-datos-bloqueados-${generadoEn.slice(0, 10)}.html`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <p className="text-muted-foreground">{t('aviso_registro')}</p>
          <div className="space-y-1">
            <Label htmlFor="motivo-tipo" className="text-xs">
              {t('motivo_tipo')}
            </Label>
            <select
              id="motivo-tipo"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={motivoTipo}
              onChange={(e) => setMotivoTipo(e.target.value as MotivoTipo | '')}
            >
              <option value="">{t('motivo_tipo_elige')}</option>
              {MOTIVOS_TIPO.map((m) => (
                <option key={m} value={m}>
                  {t(`motivos.${m}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="motivo" className="text-xs">
              {t('motivo')}
            </Label>
            <Textarea
              id="motivo"
              rows={3}
              maxLength={MOTIVO_MAX}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t('motivo_ayuda')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!valido || pending} onClick={() => pedir('ver')}>
              {t('ver')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!valido || pending}
              onClick={() => pedir('descargar')}
            >
              {t('descargar')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {contenido &&
        APARTADOS.filter((a) => a in contenido.apartados).map((a) => {
          const filas = contenido.apartados[a] ?? []
          return (
            <section key={a} className="space-y-2">
              <h2 className="text-h3 text-foreground">{t(`apartados.${a}`)}</h2>
              {filas.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('sin_filas')}</p>
              ) : (
                <Card className="divide-y">
                  {filas.map((f, i) => (
                    <dl
                      key={i}
                      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 p-4 text-xs"
                    >
                      {Object.entries(f)
                        .filter(([, v]) => v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="break-words">
                              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  ))}
                </Card>
              )}
            </section>
          )
        })}
    </div>
  )
}
