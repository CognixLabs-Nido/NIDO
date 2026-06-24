'use client'

import { AlertTriangleIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { asignarAulaPropuesta } from '../actions/asignar-aula-propuesta'
import { confirmarRollover } from '../actions/confirmar-rollover'
import { copiarConfigCurso } from '../actions/copiar-config-curso'
import { descartarPropuesta } from '../actions/descartar-propuesta'
import { proponerMatriculas } from '../actions/proponer-matriculas'
import type { ItemGraduado, ItemRevisar } from '../lib/proponer'
import type { EstadoRollover, ResultadoPropuesta } from '../types'

interface Props {
  estado: EstadoRollover
  preview: ResultadoPropuesta
  planificados: { id: string; nombre: string }[]
}

export function PasarDeCursoWizard({ estado, preview, planificados }: Props) {
  const t = useTranslations('admin.pasarDeCurso')
  const tErrors = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  const cursoId = estado.cursoDestino.id

  // Ocupación persistida (pendientes) por aula → aforo.
  const ocupacion = new Map<string, number>()
  for (const p of estado.pendientes) ocupacion.set(p.aula_id, (ocupacion.get(p.aula_id) ?? 0) + 1)

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn()
      if (r.success) {
        toast.success(okMsg)
        router.refresh()
      } else {
        toast.error(tErrors(r.error ?? 'rollover.errors.proponer_fallo'))
      }
    })

  const yaConfirmado = estado.cursoDestino.estado !== 'planificado'

  return (
    <div className="space-y-6">
      {planificados.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('curso_destino')}</span>
          <select
            className="border-border bg-background rounded-md border px-2 py-1 text-sm"
            value={cursoId}
            onChange={(e) => router.push(`${pathname}?curso=${e.target.value}`)}
          >
            {planificados.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Paso 1 — copiar configuración */}
      <Card className="space-y-3 p-4">
        <h2 className="text-foreground font-semibold">{t('paso_config')}</h2>
        <p className="text-muted-foreground text-sm">
          {t('aulas_configuradas', { n: estado.aulasDestino.length })}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || yaConfirmado}
          onClick={() =>
            run(
              () => copiarConfigCurso({ curso_destino_id: cursoId, incluir_personal: true }),
              t('config_copiada')
            )
          }
        >
          {t('copiar_config')}
        </Button>
      </Card>

      {/* Paso 2 — proponer matrículas */}
      <Card className="space-y-3 p-4">
        <h2 className="text-foreground font-semibold">{t('paso_proponer')}</h2>
        <p className="text-muted-foreground text-sm">
          {t('resumen_propuesta', {
            pendientes: estado.pendientes.length,
            porGenerar: preview.propuestas.length,
            graduados: preview.graduados.length,
            revisar: preview.requiereEleccion.length,
          })}
        </p>
        <Button
          size="sm"
          disabled={pending || yaConfirmado || estado.aulasDestino.length === 0}
          onClick={() =>
            run(() => proponerMatriculas({ curso_destino_id: cursoId }), t('propuestas_generadas'))
          }
        >
          {t('proponer')}
        </Button>
      </Card>

      {/* Aforo por aula (propuesta persistida) */}
      {estado.aulasDestino.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="text-foreground font-semibold">{t('por_aula')}</h2>
          <ul className="space-y-1 text-sm">
            {estado.aulasDestino.map((a) => {
              const n = ocupacion.get(a.aula_id) ?? 0
              const exceso = n > a.capacidad
              return (
                <li key={a.aula_id} className="flex items-center gap-2">
                  <span className="text-foreground">{a.nombre}</span>
                  <Badge variant={exceso ? 'destructive' : 'secondary'}>
                    {n} / {a.capacidad}
                  </Badge>
                  {exceso && <AlertTriangleIcon className="text-destructive size-4" />}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* Revisión manual: graduados + requieren elección */}
      {(preview.requiereEleccion.length > 0 || preview.graduados.length > 0) && (
        <Card className="space-y-3 p-4">
          <h2 className="text-foreground font-semibold">{t('revisar_titulo')}</h2>
          <ul className="space-y-2">
            {preview.requiereEleccion.map((item) => (
              <FilaAsignar
                key={item.nino_id}
                item={item}
                aulas={estado.aulasDestino.map((a) => ({ id: a.aula_id, nombre: a.nombre }))}
                cursoId={cursoId}
                disabled={pending || yaConfirmado}
                onDone={() => router.refresh()}
              />
            ))}
            {preview.graduados.map((g) => (
              <FilaGraduado
                key={g.nino_id}
                item={g}
                aulas={estado.aulasDestino.map((a) => ({ id: a.aula_id, nombre: a.nombre }))}
                cursoId={cursoId}
                disabled={pending || yaConfirmado}
                onDone={() => router.refresh()}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* Confirmar / descartar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || yaConfirmado || estado.pendientes.length === 0}
          onClick={() =>
            run(() => descartarPropuesta({ curso_destino_id: cursoId }), t('descartada'))
          }
        >
          {t('descartar')}
        </Button>
        <Button
          disabled={pending || yaConfirmado}
          onClick={() =>
            run(() => confirmarRollover({ curso_destino_id: cursoId }), t('confirmado'))
          }
        >
          {yaConfirmado ? t('ya_confirmado') : t('confirmar')}
        </Button>
      </Card>
    </div>
  )
}

function nombreNino(item: { nombre: string; apellidos: string | null }): string {
  return `${item.nombre} ${item.apellidos ?? ''}`.trim()
}

function FilaAsignar({
  item,
  aulas,
  cursoId,
  disabled,
  onDone,
}: {
  item: ItemRevisar
  aulas: { id: string; nombre: string }[]
  cursoId: string
  disabled: boolean
  onDone: () => void
}) {
  const t = useTranslations('admin.pasarDeCurso')
  const tErrors = useTranslations()
  const candidatas =
    item.motivo === 'multiples_candidatas' ? item.candidatas : aulas.map((a) => a.id)
  const [aulaId, setAulaId] = useState(candidatas[0] ?? '')
  const [pending, start] = useTransition()

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-foreground min-w-40 font-medium">{nombreNino(item)}</span>
      <Badge variant="outline">
        {item.motivo === 'sin_fecha_nacimiento' ? t('sin_fecha') : t('multiples')}
      </Badge>
      <select
        className="border-border bg-background rounded-md border px-2 py-1"
        value={aulaId}
        onChange={(e) => setAulaId(e.target.value)}
      >
        {aulas
          .filter((a) => candidatas.includes(a.id))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending || !aulaId}
        onClick={() =>
          start(async () => {
            const r = await asignarAulaPropuesta({
              curso_destino_id: cursoId,
              nino_id: item.nino_id,
              aula_id: aulaId,
            })
            if (r.success) {
              toast.success(t('asignada'))
              onDone()
            } else toast.error(tErrors(r.error))
          })
        }
      >
        {t('asignar')}
      </Button>
    </li>
  )
}

function FilaGraduado({
  item,
  aulas,
  cursoId,
  disabled,
  onDone,
}: {
  item: ItemGraduado
  aulas: { id: string; nombre: string }[]
  cursoId: string
  disabled: boolean
  onDone: () => void
}) {
  const t = useTranslations('admin.pasarDeCurso')
  const tErrors = useTranslations()
  const [aulaId, setAulaId] = useState('')
  const [pending, start] = useTransition()

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-foreground min-w-40 font-medium">{nombreNino(item)}</span>
      <Badge variant="secondary">{t('graduado')}</Badge>
      <select
        className="border-border bg-background rounded-md border px-2 py-1"
        value={aulaId}
        onChange={(e) => setAulaId(e.target.value)}
      >
        <option value="">{t('mantener_graduado')}</option>
        {aulas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending || !aulaId}
        onClick={() =>
          start(async () => {
            const r = await asignarAulaPropuesta({
              curso_destino_id: cursoId,
              nino_id: item.nino_id,
              aula_id: aulaId,
            })
            if (r.success) {
              toast.success(t('asignada'))
              onDone()
            } else toast.error(tErrors(r.error))
          })
        }
      >
        {t('asignar')}
      </Button>
    </li>
  )
}
