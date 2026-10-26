'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FiltroClaseYNombre } from '@/shared/components/FiltroClaseYNombre'
import { clasesDe, filtrarNinos } from '@/shared/lib/filtrar-ninos'

import { fijarAsignacionesConcepto } from '../actions/fijar-asignaciones-concepto'
import { cambiosAsignacion, type Destinatario } from '../lib/destinatarios-concepto'

interface Props {
  conceptoId: string
  nombre: string
  /** Ámbito del concepto: niños con su clase, o familias. */
  familia: boolean
  destinatarios: Destinatario[]
  /** Los que tienen hoy el concepto asignado. */
  asignados: string[]
}

/**
 * El concepto se gestiona desde el concepto: todos los niños (o las familias) del centro con una
 * casilla, y se marca a quién se le cobra. Se guardan de una vez solo las casillas que cambian
 * (`fijar_asignaciones_concepto`).
 */
export function ConceptoDestinatariosDialog({
  conceptoId,
  nombre,
  familia,
  destinatarios,
  asignados,
}: Props) {
  const t = useTranslations('admin.cuotas.destinatarios')
  const tRoot = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const inicial = useMemo(() => new Set(asignados), [asignados])
  const [actual, setActual] = useState<Set<string>>(inicial)
  const [aula, setAula] = useState<string | null>(null)
  const [texto, setTexto] = useState('')

  const clases = useMemo(() => clasesDe(destinatarios), [destinatarios])
  const visibles = filtrarNinos(destinatarios, aula, texto)
  const cambios = cambiosAsignacion(inicial, actual)
  // Solo los de la lista: una asignación de un niño que ya no está matriculado no se cuenta ni se toca.
  const marcados = destinatarios.filter((d) => actual.has(d.id)).length
  const todosVisiblesMarcados = visibles.length > 0 && visibles.every((d) => actual.has(d.id))

  // Al abrir, parte de lo que hay guardado, sin filtros.
  function abrir(abierto: boolean) {
    if (abierto) {
      setActual(new Set(inicial))
      setAula(null)
      setTexto('')
    }
    setOpen(abierto)
  }

  function marcar(ids: string[], valor: boolean) {
    setActual((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (valor) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function guardar() {
    startTransition(async () => {
      const r = await fijarAsignacionesConcepto(conceptoId, cambios)
      if (r.success) {
        toast.success(t('guardado', { asignadas: r.data.asignadas, quitadas: r.data.quitadas }))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {familia ? t('boton_familias') : t('boton_ninos')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {familia ? t('title_familias', { nombre }) : t('title_ninos', { nombre })}
          </DialogTitle>
          <DialogDescription>{t('desc')}</DialogDescription>
        </DialogHeader>

        {destinatarios.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {familia ? t('sin_familias') : t('sin_ninos')}
          </p>
        ) : (
          <div className="space-y-3">
            <FiltroClaseYNombre
              clases={clases}
              aula={aula}
              onAula={setAula}
              texto={texto}
              onTexto={setTexto}
            />
            <div className="flex justify-end">
              {visibles.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() =>
                    marcar(
                      visibles.map((d) => d.id),
                      !todosVisiblesMarcados
                    )
                  }
                >
                  {todosVisiblesMarcados ? t('desmarcar_todos') : t('marcar_todos')}
                </Button>
              )}
            </div>

            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
              {visibles.map((d) => (
                <li key={d.id}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={actual.has(d.id)}
                      disabled={pending}
                      onCheckedChange={(v) => marcar([d.id], v === true)}
                      aria-label={d.nombre}
                    />
                    <span className="flex-1 text-sm font-medium">{d.nombre}</span>
                    {d.aula && <span className="text-muted-foreground text-xs">{d.aula}</span>}
                  </label>
                </li>
              ))}
            </ul>
            {visibles.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {tRoot('common.filtro_ninos.sin_resultados')}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t('marcados', { n: marcados, total: destinatarios.length })}
              {cambios.length > 0 && ` · ${t('cambios', { n: cambios.length })}`}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('cancelar')}
          </Button>
          <Button type="button" onClick={guardar} disabled={cambios.length === 0 || pending}>
            {pending ? t('guardando') : t('guardar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
