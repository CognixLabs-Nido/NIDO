'use client'

import { AlertTriangleIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { asignarAulaPropuesta } from '../actions/asignar-aula-propuesta'
import { confirmarRollover } from '../actions/confirmar-rollover'
import { copiarConfigCurso } from '../actions/copiar-config-curso'
import { descartarPropuesta } from '../actions/descartar-propuesta'
import { proponerMatriculas } from '../actions/proponer-matriculas'
import { quitarAulaPropuesta } from '../actions/quitar-aula-propuesta'
import type { EstadoRollover, FilaRollover, ResultadoPropuesta } from '../types'

interface Props {
  estado: EstadoRollover
  preview: ResultadoPropuesta
  filas: FilaRollover[]
  planificados: { id: string; nombre: string }[]
}

export function PasarDeCursoWizard({ estado, preview, filas, planificados }: Props) {
  const t = useTranslations('admin.pasarDeCurso')
  const tErrors = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  const cursoId = estado.cursoDestino.id
  const yaConfirmado = estado.cursoDestino.estado !== 'planificado'
  const aulas = estado.aulasDestino.map((a) => ({ id: a.aula_id, nombre: a.nombre }))

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

      {/* Paso 3 — tabla de revisión (1 fila por niño) */}
      <Card className="space-y-3 p-4">
        <h2 className="text-foreground font-semibold">{t('paso_revisar')}</h2>
        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sin_ninos')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_nino')}</TableHead>
                <TableHead>{t('col_aula_actual')}</TableHead>
                <TableHead>{t('col_aula_propuesta')}</TableHead>
                <TableHead>{t('col_accion')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila) => (
                <FilaTabla
                  key={fila.nino_id}
                  fila={fila}
                  aulas={aulas}
                  cursoId={cursoId}
                  disabled={pending || yaConfirmado}
                  onDone={() => router.refresh()}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

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

/** Valor del desplegable cuando el niño no sube a ninguna sala (se gradúa). */
const GRADUA = '__gradua__'

function FilaTabla({
  fila,
  aulas,
  cursoId,
  disabled,
  onDone,
}: {
  fila: FilaRollover
  aulas: { id: string; nombre: string }[]
  cursoId: string
  disabled: boolean
  onDone: () => void
}) {
  const t = useTranslations('admin.pasarDeCurso')
  const tErrors = useTranslations()
  const [pending, start] = useTransition()
  const valor = fila.aula_propuesta_id ?? GRADUA

  const cambiar = (nuevo: string) =>
    start(async () => {
      const r =
        nuevo === GRADUA
          ? await quitarAulaPropuesta({ curso_destino_id: cursoId, nino_id: fila.nino_id })
          : await asignarAulaPropuesta({
              curso_destino_id: cursoId,
              nino_id: fila.nino_id,
              aula_id: nuevo,
            })
      if (r.success) {
        toast.success(nuevo === GRADUA ? t('marcado_graduado') : t('asignada'))
        onDone()
      } else {
        toast.error(tErrors(r.error ?? 'rollover.errors.asignar_fallo'))
      }
    })

  return (
    <TableRow>
      <TableCell className="font-medium">{nombreNino(fila)}</TableCell>
      <TableCell className="text-muted-foreground">
        {fila.aula_actual_nombre ?? t('sin_aula')}
      </TableCell>
      <TableCell>
        <select
          className="border-border bg-background rounded-md border px-2 py-1 text-sm"
          value={valor}
          disabled={disabled || pending}
          onChange={(e) => cambiar(e.target.value)}
        >
          {aulas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
          <option value={GRADUA}>{t('opcion_gradua')}</option>
        </select>
      </TableCell>
      <TableCell>
        {fila.accion === 'gradua' ? (
          <Badge variant="secondary">{t('graduado')}</Badge>
        ) : (
          <Badge variant="outline">{t('continua')}</Badge>
        )}
      </TableCell>
    </TableRow>
  )
}
