'use client'

import { useMemo, useState, useTransition } from 'react'

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { crearAutorizacionExcursion, enviarAutorizacion } from '../actions/gestionar-autorizacion'
import type { EventoExcursionOption } from '../queries/get-eventos-excursion'
import { ambitoEnvioEnum } from '../schemas/autorizaciones'
import type { PlantillaEnviableItem } from '../types'

interface NinoOption {
  id: string
  nombre: string
  apellidos: string
}
interface AulaOption {
  id: string
  nombre: string
}
type Ambito = (typeof ambitoEnvioEnum.options)[number]
type Modo = 'formato' | 'excursion'
const NUEVO_EVENTO = '__nuevo__'

/**
 * Desplegable «Nueva autorización» (admin). Dos modos en el mismo diálogo:
 *  - **formato**: envía una plantilla tipo A (reglas/imágenes) a una audiencia
 *    (niño/aula/centro) → instancia firmable (snapshot del texto).
 *  - **excursión**: cuelga una salida de un evento de excursión existente o crea
 *    el evento ahí mismo (sin botón aparte ni salto al calendario).
 */
export function EnviarAutorizacionDialog({
  plantillas,
  ninos,
  aulas,
  eventos,
}: {
  plantillas: PlantillaEnviableItem[]
  ninos: NinoOption[]
  aulas: AulaOption[]
  eventos: EventoExcursionOption[]
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [modo, setModo] = useState<Modo>('formato')
  const [pending, startTransition] = useTransition()

  // Modo formato
  const [plantillaId, setPlantillaId] = useState('')
  const [ambito, setAmbito] = useState<Ambito | ''>('')
  const [ninoId, setNinoId] = useState('')
  const [aulaId, setAulaId] = useState('')

  // Modo excursión
  const [eventoId, setEventoId] = useState('')
  const [tituloSalida, setTituloSalida] = useState('')
  const [nuevoTitulo, setNuevoTitulo] = useState('')
  const [nuevoFecha, setNuevoFecha] = useState('')
  const [nuevoAula, setNuevoAula] = useState('')

  const modoItems = useMemo(
    () => [
      { value: 'formato' as const, label: t('nueva.modo_formato') },
      { value: 'excursion' as const, label: t('nueva.modo_excursion') },
    ],
    [t]
  )
  const plantillaItems = useMemo(
    () => plantillas.map((p) => ({ value: p.id, label: `${p.titulo} · ${t(`tipo.${p.tipo}`)}` })),
    [plantillas, t]
  )
  const ambitoItems = useMemo(
    () => ambitoEnvioEnum.options.map((v) => ({ value: v, label: t(`ambito.${v}`) })),
    [t]
  )
  const ninoItems = useMemo(
    () => ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` })),
    [ninos]
  )
  const aulaItems = useMemo(() => aulas.map((a) => ({ value: a.id, label: a.nombre })), [aulas])
  const eventoItems = useMemo(
    () => [
      ...eventos.map((e) => ({ value: e.id, label: `${e.titulo} · ${e.fecha}` })),
      { value: NUEVO_EVENTO, label: t('excursion.crear_nueva') },
    ],
    [eventos, t]
  )

  function reset() {
    setModo('formato')
    setPlantillaId('')
    setAmbito('')
    setNinoId('')
    setAulaId('')
    setEventoId('')
    setTituloSalida('')
    setNuevoTitulo('')
    setNuevoFecha('')
    setNuevoAula('')
  }

  function onSubmit() {
    if (modo === 'formato') {
      if (!plantillaId || !ambito) {
        toast.error(t('errors.envio_fallo'))
        return
      }
      startTransition(async () => {
        const res = await enviarAutorizacion({
          plantilla_id: plantillaId,
          ambito,
          nino_id: ambito === 'nino' ? ninoId || null : null,
          aula_id: ambito === 'aula' ? aulaId || null : null,
        })
        if (!res.success) {
          toast.error(tRoot(res.error))
          return
        }
        toast.success(t('acciones.enviada_toast'))
        setOpen(false)
        reset()
        router.refresh()
      })
      return
    }

    // Excursión
    const creaNuevo = eventoId === NUEVO_EVENTO
    if (!eventoId || tituloSalida.trim().length === 0) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    if (creaNuevo && (nuevoTitulo.trim().length === 0 || !nuevoFecha || !nuevoAula)) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    startTransition(async () => {
      const res = await crearAutorizacionExcursion({
        titulo: tituloSalida.trim(),
        evento_id: creaNuevo ? null : eventoId,
        nuevo_evento: creaNuevo
          ? { titulo: nuevoTitulo.trim(), fecha: nuevoFecha, aula_id: nuevoAula }
          : null,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.creada_toast'))
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon className="mr-1 size-4" />
            {t('nueva.accion')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nueva.accion')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('nueva.modo_label')}</Label>
            <Select
              items={modoItems}
              value={modo}
              onValueChange={(v) => setModo((v as Modo) ?? 'formato')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modoItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {modo === 'formato' && (
            <>
              <p className="text-muted-foreground text-sm">{t('enviar.intro')}</p>
              <div className="space-y-2">
                <Label>{t('form.plantilla')}</Label>
                <Select
                  items={plantillaItems}
                  value={plantillaId}
                  onValueChange={(v) => setPlantillaId(v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('form.plantilla_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {plantillaItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {plantillas.length === 0 && (
                  <p className="text-muted-foreground text-xs">{t('enviar.sin_plantillas')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('form.ambito')}</Label>
                <Select
                  items={ambitoItems}
                  value={ambito}
                  onValueChange={(v) => {
                    setAmbito((v ?? '') as Ambito | '')
                    setNinoId('')
                    setAulaId('')
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('form.ambito_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {ambitoItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {ambito === 'nino' && (
                <div className="space-y-2">
                  <Label>{t('form.nino')}</Label>
                  <Select
                    items={ninoItems}
                    value={ninoId}
                    onValueChange={(v) => setNinoId(v ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('form.nino_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {ninoItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {ambito === 'aula' && (
                <div className="space-y-2">
                  <Label>{t('form.aula')}</Label>
                  <Select
                    items={aulaItems}
                    value={aulaId}
                    onValueChange={(v) => setAulaId(v ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('form.aula_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {aulaItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {modo === 'excursion' && (
            <>
              <p className="text-muted-foreground text-sm">{t('excursion.intro')}</p>
              <div className="space-y-2">
                <Label>{t('form.evento')}</Label>
                <Select
                  items={eventoItems}
                  value={eventoId}
                  onValueChange={(v) => setEventoId(v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('form.evento_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {eventoItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {eventoId === NUEVO_EVENTO && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nuevo-evento-titulo">{t('excursion.nuevo_titulo')}</Label>
                    <Input
                      id="nuevo-evento-titulo"
                      value={nuevoTitulo}
                      onChange={(e) => setNuevoTitulo(e.target.value)}
                      maxLength={200}
                      placeholder={t('excursion.nuevo_titulo_placeholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nuevo-evento-fecha">{t('excursion.nuevo_fecha')}</Label>
                    <Input
                      id="nuevo-evento-fecha"
                      type="date"
                      value={nuevoFecha}
                      onChange={(e) => setNuevoFecha(e.target.value)}
                    />
                  </div>
                  {/* Aula que va = audiencia del evento (las familias que firmarán). */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{t('excursion.nuevo_aula')}</Label>
                    <Select
                      items={aulaItems}
                      value={nuevoAula}
                      onValueChange={(v) => setNuevoAula(v ?? '')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('form.aula_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {aulaItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="titulo-salida">{t('form.titulo')}</Label>
                <Input
                  id="titulo-salida"
                  value={tituloSalida}
                  onChange={(e) => setTituloSalida(e.target.value)}
                  maxLength={200}
                  placeholder={t('form.titulo_placeholder')}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? t('acciones.creando') : t('acciones.crear')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
