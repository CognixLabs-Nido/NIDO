'use client'

import { useMemo, useState, useTransition } from 'react'

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { crearAutorizacionExcursion, crearPlantilla } from '../actions/gestionar-autorizacion'
import type { EventoExcursionOption } from '../queries/get-eventos-excursion'
import { tipoPlantillaEnum, type TipoPlantilla } from '../schemas/autorizaciones'

interface AulaOption {
  id: string
  nombre: string
}

// Tipo del selector: los 4 formatos durables del catálogo + «excursión» (salida
// bespoke por evento, NO va al catálogo).
type TipoNueva = TipoPlantilla | 'excursion'
const EXCURSION = 'excursion' as const
const NUEVO_EVENTO = '__nuevo__'

/**
 * Diálogo admin «Nueva autorización». Un único selector de tipo:
 *  - tipos del catálogo (reglas/imágenes/recogida/medicación) → crea la
 *    **plantilla durable** (el formato estándar del centro; el texto y la
 *    publicación se completan luego desde su detalle).
 *  - **excursión** → cuelga una salida de un evento existente o lo crea ahí
 *    mismo (con el aula que va = audiencia) y publica el texto en un solo paso.
 */
export function CrearPlantillaDialog({
  eventos,
  aulas,
}: {
  eventos: EventoExcursionOption[]
  aulas: AulaOption[]
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<TipoNueva | ''>('')
  const [titulo, setTitulo] = useState('')
  const [pending, startTransition] = useTransition()

  // Solo modo excursión
  const [eventoId, setEventoId] = useState('')
  const [nuevoTitulo, setNuevoTitulo] = useState('')
  const [nuevoFecha, setNuevoFecha] = useState('')
  const [nuevoAula, setNuevoAula] = useState('')
  const [textoSalida, setTextoSalida] = useState('')
  const [borrador, setBorrador] = useState(false)

  const tipoItems = useMemo(
    () => [
      ...tipoPlantillaEnum.options.map((v) => ({ value: v, label: t(`tipo.${v}`) })),
      { value: EXCURSION, label: t('tipo.excursion') },
    ],
    [t]
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
    setTipo('')
    setTitulo('')
    setEventoId('')
    setNuevoTitulo('')
    setNuevoFecha('')
    setNuevoAula('')
    setTextoSalida('')
    setBorrador(false)
  }

  function onSubmit() {
    if (tipo === EXCURSION) {
      const creaNuevo = eventoId === NUEVO_EVENTO
      if (!eventoId || titulo.trim().length === 0 || textoSalida.trim().length === 0) {
        toast.error(t('errors.creacion_fallo'))
        return
      }
      if (creaNuevo && (nuevoTitulo.trim().length === 0 || !nuevoFecha || !nuevoAula)) {
        toast.error(t('errors.creacion_fallo'))
        return
      }
      startTransition(async () => {
        const res = await crearAutorizacionExcursion({
          titulo: titulo.trim(),
          texto: textoSalida.trim(),
          borrador,
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
      return
    }

    // Tipo del catálogo: crea la plantilla durable.
    if (!tipo || titulo.trim().length === 0) {
      toast.error(t('errors.creacion_fallo'))
      return
    }
    startTransition(async () => {
      const res = await crearPlantilla({ tipo, titulo: titulo.trim() })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.plantilla_creada_toast'))
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  const esExcursion = tipo === EXCURSION

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon className="mr-1 size-4" />
            {t('acciones.nueva')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('acciones.nueva')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('form.tipo')}</Label>
            <Select
              items={tipoItems}
              value={tipo}
              onValueChange={(v) => setTipo((v ?? '') as TipoNueva | '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('form.tipo_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {tipoItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!esExcursion && tipo !== '' && (
              <p className="text-muted-foreground text-sm">{t('catalogo.intro')}</p>
            )}
          </div>

          {esExcursion && (
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

              {/* Texto de consentimiento a medida — se publica en un paso. */}
              <div className="space-y-2">
                <Label htmlFor="texto-salida">{t('excursion.texto')}</Label>
                <Textarea
                  id="texto-salida"
                  value={textoSalida}
                  onChange={(e) => setTextoSalida(e.target.value)}
                  rows={5}
                  maxLength={20000}
                  placeholder={t('excursion.texto_placeholder')}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={borrador} onCheckedChange={(c) => setBorrador(c === true)} />
                {t('excursion.guardar_borrador')}
              </label>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="titulo-nueva">{t('form.titulo')}</Label>
            <Input
              id="titulo-nueva"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder={
                esExcursion ? t('form.titulo_placeholder') : t('form.titulo_plantilla_placeholder')
              }
            />
          </div>
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
