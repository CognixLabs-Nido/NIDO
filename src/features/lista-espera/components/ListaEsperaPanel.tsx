'use client'

import {
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
  UserRoundPenIcon,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/shared/components/EmptyState'

import { parentescoEnum } from '@/features/vinculos/schemas/vinculo'

import { completarEnDireccion } from '../actions/completar-direccion'
import { descartarProspecto } from '../actions/descartar-prospecto'
import { invitarAlAlta } from '../actions/invitar-al-alta'
import { reordenarListaEspera } from '../actions/reordenar-lista-espera'
import { superaCapacidad, type AulaConOcupacion } from '../lib/ocupacion'
import type { ProspectoListItem } from '../queries/get-lista-espera'

import { ProspectoFormDialog } from './ProspectoFormDialog'

interface CursoOpcion {
  id: string
  nombre: string
}

interface Props {
  cursos: CursoOpcion[]
  cursoSeleccionadoId: string
  prospectos: ProspectoListItem[]
  /** Aulas del curso ACTIVO con ocupación (para fijar aula + aviso de capacidad al invitar). */
  aulas: AulaConOcupacion[]
  locale: string
}

export function ListaEsperaPanel({
  cursos,
  cursoSeleccionadoId,
  prospectos,
  aulas,
  locale,
}: Props) {
  const t = useTranslations('admin.admisiones')
  const tErrors = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  // Orden local optimista; se re-sincroniza con el servidor sin useEffect
  // (patrón "ajustar estado en render" — apto para React Compiler).
  const [orden, setOrden] = useState(prospectos)
  const [prev, setPrev] = useState(prospectos)
  if (prospectos !== prev) {
    setPrev(prospectos)
    setOrden(prospectos)
  }

  const [dragId, setDragId] = useState<string | null>(null)

  const persistirOrden = (lista: ProspectoListItem[]) =>
    start(async () => {
      const r = await reordenarListaEspera({
        curso_academico_id: cursoSeleccionadoId,
        orden: lista.map((p) => p.id),
      })
      if (r.success) {
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
        setOrden(prospectos) // revertir
      }
    })

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const from = orden.findIndex((p) => p.id === dragId)
    const to = orden.findIndex((p) => p.id === targetId)
    if (from === -1 || to === -1) return setDragId(null)
    const nuevo = [...orden]
    const [movido] = nuevo.splice(from, 1)
    nuevo.splice(to, 0, movido!)
    setOrden(nuevo)
    setDragId(null)
    persistirOrden(nuevo)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('curso')}</span>
          <select
            className="border-border bg-background rounded-md border px-2 py-1 text-sm"
            value={cursoSeleccionadoId}
            onChange={(e) => router.push(`${pathname}?curso=${e.target.value}`)}
          >
            {cursos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <ProspectoFormDialog
          cursoId={cursoSeleccionadoId}
          trigger={<Button size="sm">{t('nuevo')}</Button>}
        />
      </div>

      <Card className="p-0">
        {orden.length === 0 ? (
          <EmptyState
            icon={<UserPlusIcon strokeWidth={1.75} />}
            title={t('vacio')}
            description={t('vacio_desc')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t('fields.nombre_nino')}</TableHead>
                <TableHead>{t('fields.fecha_nacimiento')}</TableHead>
                <TableHead>{t('fields.contacto')}</TableHead>
                <TableHead>{t('estado')}</TableHead>
                <TableHead className="text-right">{t('acciones')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orden.map((p) => (
                <TableRow
                  key={p.id}
                  draggable={!pending}
                  onDragStart={() => setDragId(p.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(p.id)}
                  className={dragId === p.id ? 'opacity-50' : undefined}
                >
                  <TableCell className="text-muted-foreground cursor-grab active:cursor-grabbing">
                    <GripVerticalIcon className="size-4" />
                  </TableCell>
                  <TableCell className="font-medium">{p.nombre_nino}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.fecha_nacimiento ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <div>{p.email_tutor ?? '—'}</div>
                    <div>{p.telefono_tutor ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.estado === 'invitado' ? 'secondary' : 'outline'}>
                      {t(`estados.${p.estado}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {p.estado === 'en_espera' && (
                        <>
                          <InvitarBoton
                            id={p.id}
                            aulas={aulas}
                            locale={locale}
                            disabled={pending}
                          />
                          <CompletarBoton
                            id={p.id}
                            aulas={aulas}
                            locale={locale}
                            disabled={pending}
                          />
                        </>
                      )}
                      <ProspectoFormDialog
                        cursoId={cursoSeleccionadoId}
                        prospecto={p}
                        trigger={
                          <Button size="icon" variant="ghost" aria-label={t('editar')}>
                            <PencilIcon className="size-4" />
                          </Button>
                        }
                      />
                      <DescartarBoton id={p.id} nombre={p.nombre_nino} disabled={pending} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function InvitarBoton({
  id,
  aulas,
  locale,
  disabled,
}: {
  id: string
  aulas: AulaConOcupacion[]
  locale: string
  disabled: boolean
}) {
  const t = useTranslations('admin.admisiones')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [aulaId, setAulaId] = useState('')
  const [pending, start] = useTransition()

  const aulaSel = aulas.find((a) => a.aulaId === aulaId)
  const exceso = aulaSel ? superaCapacidad(aulaSel.ocupacion, aulaSel.capacidad) : false

  const invitar = () =>
    start(async () => {
      const r = await invitarAlAlta({ id, aulaId }, locale)
      if (r.success) {
        toast.success(t('invitado'))
        setOpen(false)
        setAulaId('')
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('invitar')}
        title={t('invitar')}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <UserPlusIcon className="size-4" />
      </Button>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('invitar_dialog.title')}</DialogTitle>
        </DialogHeader>

        {aulas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('invitar_dialog.sin_aulas')}</p>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('invitar_dialog.aula_label')}</span>
              <select
                className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                value={aulaId}
                onChange={(e) => setAulaId(e.target.value)}
              >
                <option value="">{t('invitar_dialog.aula_placeholder')}</option>
                {aulas.map((a) => (
                  <option key={a.aulaId} value={a.aulaId}>
                    {a.nombre} ({a.ocupacion}/{a.capacidad})
                  </option>
                ))}
              </select>
            </label>

            {exceso && aulaSel && (
              <p className="text-destructive text-sm">
                {t('invitar_dialog.exceso', { capacidad: aulaSel.capacidad })}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t('cancel')}
              </Button>
              <Button
                variant={exceso ? 'destructive' : 'default'}
                onClick={invitar}
                disabled={pending || !aulaId}
              >
                {exceso ? t('invitar_dialog.confirmar_exceso') : t('invitar_dialog.invitar')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Botón "Completar (Dirección)" (PR-3a): la Dirección crea el alta en nombre del tutor SIN
 * enviar email. Pide aula (como invitar) + credenciales que la Dirección fija para el tutor
 * (email + contraseña provisional) + parentesco. Al confirmar, `completarEnDireccion` crea
 * cuenta + rol + vínculo + niño + matrícula, y llevamos a la ficha del niño. El cableado del
 * wizard en "modo Dirección" y las acciones tutor-only llegan en PR-3b.
 */
function CompletarBoton({
  id,
  aulas,
  locale,
  disabled,
}: {
  id: string
  aulas: AulaConOcupacion[]
  locale: string
  disabled: boolean
}) {
  const t = useTranslations('admin.admisiones')
  const tParentesco = useTranslations('vinculo.parentesco')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [aulaId, setAulaId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [parentesco, setParentesco] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [pending, start] = useTransition()

  const aulaSel = aulas.find((a) => a.aulaId === aulaId)
  const exceso = aulaSel ? superaCapacidad(aulaSel.ocupacion, aulaSel.capacidad) : false
  const requiereDescripcion = parentesco === 'otro'
  const listo =
    !!aulaId && !!email && !!password && !!parentesco && (!requiereDescripcion || !!descripcion)

  const reset = () => {
    setAulaId('')
    setEmail('')
    setPassword('')
    setParentesco('')
    setDescripcion('')
  }

  const completar = () =>
    start(async () => {
      const r = await completarEnDireccion(
        {
          id,
          aulaId,
          email,
          password,
          parentesco: parentesco as (typeof parentescoEnum.options)[number],
          descripcionParentesco: requiereDescripcion ? descripcion : null,
        },
        locale as 'es' | 'en' | 'va'
      )
      if (r.success) {
        toast.success(t('completado'))
        setOpen(false)
        reset()
        router.push(`/${locale}/admin/ninos/${r.data.ninoId}`)
      } else {
        toast.error(tErrors(r.error))
      }
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('completar')}
        title={t('completar')}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <UserRoundPenIcon className="size-4" />
      </Button>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('completar_dialog.title')}</DialogTitle>
        </DialogHeader>

        {aulas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('invitar_dialog.sin_aulas')}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">{t('completar_dialog.descripcion')}</p>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('invitar_dialog.aula_label')}</span>
              <select
                className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                value={aulaId}
                onChange={(e) => setAulaId(e.target.value)}
              >
                <option value="">{t('invitar_dialog.aula_placeholder')}</option>
                {aulas.map((a) => (
                  <option key={a.aulaId} value={a.aulaId}>
                    {a.nombre} ({a.ocupacion}/{a.capacidad})
                  </option>
                ))}
              </select>
            </label>

            {exceso && aulaSel && (
              <p className="text-destructive text-sm">
                {t('invitar_dialog.exceso', { capacidad: aulaSel.capacidad })}
              </p>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('completar_dialog.email_label')}</span>
              <input
                type="email"
                autoComplete="off"
                className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                placeholder={t('completar_dialog.email_placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('completar_dialog.password_label')}</span>
              <input
                type="password"
                autoComplete="new-password"
                className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="text-muted-foreground block text-xs">
                {t('completar_dialog.password_hint')}
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t('completar_dialog.parentesco_label')}</span>
              <select
                className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                value={parentesco}
                onChange={(e) => setParentesco(e.target.value)}
              >
                <option value="">{t('completar_dialog.parentesco_placeholder')}</option>
                {parentescoEnum.options.map((p) => (
                  <option key={p} value={p}>
                    {tParentesco(p)}
                  </option>
                ))}
              </select>
            </label>

            {requiereDescripcion && (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">
                  {t('completar_dialog.descripcion_label')}
                </span>
                <input
                  type="text"
                  maxLength={120}
                  className="border-border bg-background w-full rounded-md border px-2 py-2 text-sm"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </label>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t('cancel')}
              </Button>
              <Button
                variant={exceso ? 'destructive' : 'default'}
                onClick={completar}
                disabled={pending || !listo}
              >
                {t('completar_dialog.crear')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DescartarBoton({
  id,
  nombre,
  disabled,
}: {
  id: string
  nombre: string
  disabled: boolean
}) {
  const t = useTranslations('admin.admisiones')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('borrar')}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon className="text-destructive size-4" />
      </Button>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('borrar_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('borrar_confirma', { nombre })}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await descartarProspecto({ id })
                if (r.success) {
                  toast.success(t('borrado'))
                  setOpen(false)
                  router.refresh()
                } else {
                  toast.error(tErrors(r.error))
                }
              })
            }
          >
            {t('borrar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
