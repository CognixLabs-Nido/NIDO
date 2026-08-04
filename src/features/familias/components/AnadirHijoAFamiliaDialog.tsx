'use client'

import { ChevronLeftIcon, ChevronRightIcon, UsersRoundIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { anadirHijoAFamilia } from '../actions/anadir-hijo-a-familia'
import type { FamiliaItem } from '../queries/get-familias'

interface Props {
  familias: FamiliaItem[]
  /** ¿El centro tiene curso activo? Sin él no hay cola donde encolar el prospecto. */
  hayCursoActivo: boolean
}

type Filtro = 'todas' | 'activas' | 'inactivas'

/**
 * U-2 (alta unificada) — "Añadir hijo a familia existente" crea un PROSPECTO en admisiones,
 * como cualquier otro alumno; ya NO crea el niño ni la matrícula (esa puerta directa es la
 * que hacía desaparecer al 2.º hijo de la lista). Paso 1: elegir familia del centro (buscador
 * + filtro activas/inactivas). Paso 2: datos del niño. Al confirmar, la server action encola
 * el prospecto en el curso activo guardando el `usuario_id` del tutor (D1).
 *
 * Ya no se piden aquí el AULA (se elige al promover, que es cuando nace la matrícula) ni el
 * PARENTESCO (lo hereda la vinculación del vínculo previo del tutor).
 */
export function AnadirHijoAFamiliaDialog({ familias, hayCursoActivo }: Props) {
  const t = useTranslations('admin.admisiones.anadirHijo')
  const tErrors = useTranslations()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [paso, setPaso] = useState<1 | 2>(1)
  const [filtro, setFiltro] = useState<Filtro>('activas')
  const [busca, setBusca] = useState('')
  const [familia, setFamilia] = useState<FamiliaItem | null>(null)
  const [nombre, setNombre] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [pending, startTransition] = useTransition()

  const sinCursoActivo = !hayCursoActivo

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return familias.filter((f) => {
      if (filtro === 'activas' && f.estado !== 'activa') return false
      if (filtro === 'inactivas' && f.estado !== 'inactiva') return false
      if (!q) return true
      return (
        (f.etiqueta ?? '').toLowerCase().includes(q) ||
        (f.titularNombre ?? '').toLowerCase().includes(q)
      )
    })
  }, [familias, filtro, busca])

  function reset() {
    setPaso(1)
    setFiltro('activas')
    setBusca('')
    setFamilia(null)
    setNombre('')
    setApellidos('')
    setFechaNacimiento('')
  }

  const puedeConfirmar =
    !!familia &&
    !sinCursoActivo &&
    nombre.trim().length > 0 &&
    apellidos.trim().length > 0 &&
    fechaNacimiento.length > 0 &&
    !pending

  function confirmar() {
    if (!puedeConfirmar || !familia) return
    startTransition(async () => {
      try {
        const r = await anadirHijoAFamilia({
          familia_id: familia.id,
          nombre: nombre.trim(),
          apellidos: apellidos.trim(),
          fecha_nacimiento: fechaNacimiento,
        })
        if (r.success) {
          toast.success(t('exito'))
          setOpen(false)
          reset()
          router.refresh()
        } else {
          toast.error(tErrors(r.error))
        }
      } catch {
        // Rejección de la server action (timeout de función serverless, red): antes se tragaba
        // en el useTransition → botón mudo (BUG del flujo 3). Espejo de los diálogos completar/
        // invitar: ahora SIEMPRE se avisa; el `pending` vuelve a false al asentarse la transición.
        toast.error(tErrors('auth.invitation.errors.servicio_cuentas_no_disponible'))
      }
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UsersRoundIcon />
        {t('boton')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titulo')}</DialogTitle>
            <DialogDescription>
              {paso === 1 ? t('paso1_desc') : t('paso2_desc', { familia: familia?.etiqueta ?? '' })}
            </DialogDescription>
          </DialogHeader>

          {paso === 1 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {(['activas', 'inactivas', 'todas'] as const).map((f) => (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant={filtro === f ? 'default' : 'outline'}
                    onClick={() => setFiltro(f)}
                  >
                    {t(`filtro.${f}`)}
                  </Button>
                ))}
              </div>
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t('buscar_placeholder')}
                autoComplete="off"
                data-testid="anadir-hijo-buscar"
              />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {visibles.length === 0 ? (
                  <p className="text-muted-foreground px-1 py-6 text-center text-sm">
                    {t('sin_familias')}
                  </p>
                ) : (
                  visibles.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setFamilia(f)
                        setPaso(2)
                      }}
                      data-testid="anadir-hijo-familia"
                      className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="text-foreground block truncate text-sm font-medium">
                          {f.etiqueta ?? '—'}
                          {f.estado === 'inactiva' && (
                            <Badge variant="warm" className="ml-2 align-middle">
                              {t('inactiva')}
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {f.titularNombre ?? '—'}
                          {f.titularEmail ? ` · ${f.titularEmail}` : ''} ·{' '}
                          {t('hijos', { n: f.hijosActivos })}
                        </span>
                      </span>
                      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sinCursoActivo && (
                <div className="border-warm-300 bg-warm-100 text-warm-800 rounded-xl border-l-4 px-4 py-3 text-sm">
                  {t('sin_curso_activo')}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ah-nombre">{t('fields.nombre')}</Label>
                  <Input
                    id="ah-nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    data-testid="anadir-hijo-nombre"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ah-apellidos">{t('fields.apellidos')}</Label>
                  <Input
                    id="ah-apellidos"
                    value={apellidos}
                    onChange={(e) => setApellidos(e.target.value)}
                    data-testid="anadir-hijo-apellidos"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ah-fecha">{t('fields.fecha_nacimiento')}</Label>
                <Input
                  id="ah-fecha"
                  type="date"
                  value={fechaNacimiento}
                  onChange={(e) => setFechaNacimiento(e.target.value)}
                  data-testid="anadir-hijo-fecha"
                />
              </div>
              {/* U-2: el prospecto entra en la cola de admisiones; el aula y el resto del alta
                  se resuelven al promoverlo (Invitar / Completar → wizard). */}
              <p className="text-muted-foreground text-sm">{t('nota_prospecto')}</p>
            </div>
          )}

          <DialogFooter>
            {paso === 2 && (
              <Button type="button" variant="ghost" onClick={() => setPaso(1)}>
                <ChevronLeftIcon />
                {t('volver')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              {t('cancelar')}
            </Button>
            {paso === 2 && (
              <Button
                type="button"
                onClick={confirmar}
                disabled={!puedeConfirmar}
                data-testid="anadir-hijo-confirm"
              >
                {pending ? t('procesando') : t('confirmar')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
