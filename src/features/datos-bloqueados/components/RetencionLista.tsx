'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { FiltroClaseYNombre } from '@/shared/components/FiltroClaseYNombre'
import { localeIntl } from '@/shared/lib/locale-intl'

import { ponerRetencion, quitarRetencion } from '../actions/retencion'
import {
  claveSujeto,
  clasesDeSujetos,
  filtrarSujetos,
  type EstadoFiltro,
  type SujetoListado,
  type TipoFiltro,
} from '../lib/filtrar-retencion'
import { MOTIVO_MAX, MOTIVO_MIN, MOTIVOS_TIPO, type MotivoTipo } from '../types'

export interface SujetoRetencionFila extends SujetoListado {
  desde: string | null
  motivo_tipo: string | null
}

const TIPOS: TipoFiltro[] = ['todos', 'nino', 'usuario']
const ESTADOS: EstadoFiltro[] = ['todos', 'activo', 'baja', 'purgado']

/**
 * Todos los sujetos del centro, para retenerlos ante un procedimiento abierto (20261206120000):
 * filtro por clase, tipo y estado, búsqueda por nombre o familia, y selección múltiple para poner
 * o quitar la retención a varios de golpe. Poner pide tipo y motivo; quitar, motivo. Quién puede lo
 * decide la BD (solo la titular), y la página se recarga con lo que quedó.
 */
export function RetencionLista({
  centroId,
  filas,
}: {
  centroId: string
  filas: SujetoRetencionFila[]
}) {
  const t = useTranslations('datos_bloqueados')
  const tTodo = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [aula, setAula] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoFiltro>('todos')
  const [estado, setEstado] = useState<EstadoFiltro>('todos')
  const [soloRetenidos, setSoloRetenidos] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set())
  const [accion, setAccion] = useState<'poner' | 'quitar' | null>(null)
  const [motivoTipo, setMotivoTipo] = useState<MotivoTipo | ''>('')
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  const clases = useMemo(() => clasesDeSujetos(filas), [filas])
  const visibles = filtrarSujetos(filas, { aula, texto, tipo, estado, soloRetenidos })
  const todosVisibles = visibles.length > 0 && visibles.every((s) => seleccion.has(claveSujeto(s)))
  const elegidos = filas.filter((s) => seleccion.has(claveSujeto(s)))
  const valido = motivo.trim().length >= MOTIVO_MIN && (accion === 'quitar' || motivoTipo !== '')

  // Una fecha sin hora: se lee en UTC para que no cambie de día.
  const fecha = new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'medium' })
  const dia = (d: string) => fecha.format(new Date(`${d}T00:00:00Z`))
  // Un instante, en el día de Madrid.
  const fechaMadrid = new Intl.DateTimeFormat(localeIntl(locale), {
    dateStyle: 'medium',
    timeZone: 'Europe/Madrid',
  })

  function marcar(clave: string, si: boolean) {
    setSeleccion((prev) => {
      const s = new Set(prev)
      if (si) s.add(clave)
      else s.delete(clave)
      return s
    })
  }

  function marcarVisibles(si: boolean) {
    setSeleccion((prev) => {
      const s = new Set(prev)
      for (const v of visibles) {
        if (si) s.add(claveSujeto(v))
        else s.delete(claveSujeto(v))
      }
      return s
    })
  }

  function cerrar() {
    setAccion(null)
    setMotivo('')
    setMotivoTipo('')
  }

  function confirmar() {
    if (!accion || !valido || elegidos.length === 0) return
    const sujetos = elegidos.map((s) => ({
      tipo: s.sujeto_tipo as 'nino' | 'usuario',
      id: s.sujeto_id,
    }))
    startTransition(async () => {
      const r =
        accion === 'poner'
          ? await ponerRetencion({ centroId, sujetos, motivoTipo, motivo })
          : await quitarRetencion({ centroId, sujetos, motivo })
      if (!r.success) {
        toast.error(tTodo(r.error))
        return
      }
      toast.success(
        t(accion === 'poner' ? 'retencion.puestas' : 'retencion.quitadas', { n: r.data })
      )
      setSeleccion(new Set())
      cerrar()
      router.refresh()
    })
  }

  function textoEstado(s: SujetoRetencionFila): string {
    if (s.estado === 'activo') return t('retencion.estados.activo')
    if (s.estado === 'purgado')
      return s.desde
        ? t('retencion.estados.purgado', { fecha: dia(s.desde) })
        : t('retencion.estados.purgado_sin_fecha')
    return s.desde
      ? t('retencion.estados.baja', { fecha: dia(s.desde) })
      : t('retencion.estados.baja_sin_fecha')
  }

  if (filas.length === 0) {
    return <Card className="text-muted-foreground p-6 text-sm">{t('retencion.lista_vacia')}</Card>
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 overflow-hidden p-4">
        <FiltroClaseYNombre
          clases={clases}
          aula={aula}
          onAula={setAula}
          texto={texto}
          onTexto={setTexto}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            aria-label={t('retencion.filtro_tipo')}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoFiltro)}
          >
            {TIPOS.map((v) => (
              <option key={v} value={v}>
                {t(`retencion.tipos.${v}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('retencion.filtro_estado')}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
          >
            {ESTADOS.map((v) => (
              <option key={v} value={v}>
                {t(`retencion.estados_filtro.${v}`)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={soloRetenidos}
              onCheckedChange={(v) => setSoloRetenidos(v === true)}
            />
            {t('retencion.solo_retenidos')}
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {t('retencion.seleccionados', { n: elegidos.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={elegidos.length === 0 || pending}
              onClick={() => setAccion('poner')}
            >
              {t('retencion.poner')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={elegidos.length === 0 || pending}
              onClick={() => setAccion('quitar')}
            >
              {t('retencion.quitar')}
            </Button>
          </div>
        </div>

        {accion && (
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="text-foreground font-medium">
                {t(accion === 'poner' ? 'retencion.poner_titulo' : 'retencion.quitar_titulo', {
                  n: elegidos.length,
                })}
              </p>
              <p className="text-muted-foreground">{t('retencion.aviso_registro')}</p>
              {accion === 'poner' && (
                <div className="space-y-1">
                  <Label htmlFor="retencion-motivo-tipo" className="text-xs">
                    {t('motivo_tipo')}
                  </Label>
                  <select
                    id="retencion-motivo-tipo"
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
              )}
              <div className="space-y-1">
                <Label htmlFor="retencion-motivo" className="text-xs">
                  {t('motivo')}
                </Label>
                <Textarea
                  id="retencion-motivo"
                  rows={3}
                  maxLength={MOTIVO_MAX}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t(accion === 'poner' ? 'motivo_ayuda' : 'retencion.motivo_quitar_ayuda')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={!valido || pending} onClick={confirmar}>
                  {t('retencion.confirmar')}
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={cerrar}>
                  {t('retencion.cancelar')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={todosVisibles}
                  disabled={visibles.length === 0}
                  onCheckedChange={(v) => marcarVisibles(v === true)}
                  aria-label={t('retencion.seleccionar_visibles')}
                />
              </TableHead>
              <TableHead>{t('retencion.col_nombre')}</TableHead>
              <TableHead>{t('retencion.col_clase')}</TableHead>
              <TableHead>{t('retencion.col_estado')}</TableHead>
              <TableHead>{t('retencion.col_retencion')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((s) => {
              const clave = claveSujeto(s)
              const nombre = s.nombre || t('retencion.sin_nombre')
              return (
                <TableRow key={clave}>
                  <TableCell>
                    <Checkbox
                      checked={seleccion.has(clave)}
                      onCheckedChange={(v) => marcar(clave, v === true)}
                      aria-label={t('retencion.seleccionar', { nombre })}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="text-foreground font-medium">{nombre}</p>
                    <p className="text-muted-foreground text-xs">
                      {s.sujeto_tipo === 'nino' ? t('sujeto_nino') : t('sujeto_usuario')}
                      {s.familia ? ` · ${t('familia', { familia: s.familia })}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.aula ?? '—'}</TableCell>
                  <TableCell className="text-sm">{textoEstado(s)}</TableCell>
                  <TableCell className="text-sm">
                    {s.retenido_desde
                      ? t('retencion.retenido', {
                          fecha: fechaMadrid.format(new Date(s.retenido_desde)),
                          motivo: s.motivo_tipo ? t(`motivos.${s.motivo_tipo}`) : '',
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {visibles.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {tTodo('common.filtro_ninos.sin_resultados')}
          </p>
        )}
      </Card>
    </div>
  )
}
