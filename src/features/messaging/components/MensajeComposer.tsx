'use client'

import { SendHorizonalIcon } from 'lucide-react'
import { useTransition, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { abrirConversacionAdminFamilia } from '../actions/abrir-conversacion-admin-familia'
import { enviarMensaje } from '../actions/enviar-mensaje'

interface ProfeFamiliaProps {
  /** Modo opcional; si se omite se asume 'profe_familia' (compatibilidad F5). */
  mode?: 'profe_familia'
  ninoId: string
  locale: string
  /**
   * Si la conversación ya existe, el composer no necesita navegar después de
   * enviar; el router.refresh() trae el mensaje nuevo. Si la conversación
   * NO existía aún (composer dentro de la ficha del niño en modo "iniciar"),
   * el action devuelve el id y navegamos al hilo.
   */
  redirectOnFirstSend?: boolean
}

interface AdminFamiliaProps {
  mode: 'admin_familia'
  conversacionId: string
  /** ISO timestamp; si <= now() el composer se renderiza deshabilitado con aviso. */
  expiresAt: string
  locale: string
}

interface AdminFamiliaIniciarProps {
  /** F5B-Items1+2 — modo "iniciar" del SplitView del admin. La conversación
   *  con este tutor no existe aún; al enviar el primer mensaje se llama
   *  secuencialmente `abrirConversacionAdminFamilia` + `enviarMensaje`.
   *  Tras éxito hace `router.refresh()`; el SSR recarga la lista y el panel
   *  pasa a renderizar `ConversacionAdminFamiliaView` con el hilo ya
   *  creado. */
  mode: 'admin_familia_iniciar'
  tutorId: string
  locale: string
}

type Props = ProfeFamiliaProps | AdminFamiliaProps | AdminFamiliaIniciarProps

const MAX = 2000

/**
 * Composer de mensaje. Acepta dos modos discriminados:
 *
 *  - `profe_familia` (legacy F5, default cuando se omite `mode`): direcciona
 *    por `ninoId`. La invocación a `enviarMensaje` es bit-a-bit la de F5
 *    (sin `kind`, confiando en el default del schema). Esto preserva los
 *    tests de regresión existentes que asertan
 *    `toHaveBeenCalledWith({ nino_id, contenido })`.
 *  - `admin_familia` (F5.6-A): direcciona por `conversacionId`. Si
 *    `expiresAt <= now()` el composer se renderiza deshabilitado con
 *    el aviso "conversación cerrada". El envío usa
 *    `{ kind: 'admin_familia', conversacion_id, contenido }`.
 *
 * Mantenemos el `<button>` HTML nativo (no el `<Button>` de shadcn) por
 * el problema histórico del primitive `@base-ui/react/button` que fuerza
 * `type="button"` con prioridad sobre cualquier `type` que le pase el
 * caller — ver Bug 1 post-F5.
 */
export function MensajeComposer(props: Props) {
  const t = useTranslations('messages.conversacion')
  const tAdmin = useTranslations('messages.admin_familia')
  const tErr = useTranslations('messages.errors')
  const [contenido, setContenido] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const isAdminFamilia = props.mode === 'admin_familia'
  const isAdminFamiliaIniciar = props.mode === 'admin_familia_iniciar'
  // `Date.now()` es impuro en el body del componente (regla
  // `react-hooks/purity` de React 19). Lo snapshoteamos al montar con un
  // lazy initializer; si la caducidad cambia mientras la página está
  // abierta, un refresh muestra el estado nuevo (spec: sin countdown).
  const [nowMs] = useState(() => Date.now())
  const caducada = isAdminFamilia && Date.parse((props as AdminFamiliaProps).expiresAt) <= nowMs

  const length = contenido.length
  const trimmed = contenido.trim()
  const disabled = pending || caducada || trimmed.length === 0 || trimmed.length > MAX

  function send() {
    if (disabled) return
    startTransition(async () => {
      try {
        if (isAdminFamiliaIniciar) {
          // Flujo secuencial cliente (F5B-Items1+2):
          //   1. UPSERT del hilo (idempotente).
          //   2. INSERT del primer mensaje (RLS bloquea si paso 1 falló).
          // Si paso 2 falla tras éxito de paso 1, el hilo queda creado
          // con expires_at y sin mensajes; el usuario reintenta y el
          // siguiente envío usa el mismo hilo (mismo patrón "conv lazy
          // sin mensajes" que profe_familia).
          const abrir = await abrirConversacionAdminFamilia(
            (props as AdminFamiliaIniciarProps).tutorId
          )
          if (!abrir.success) {
            const key = abrir.error.startsWith('messages.errors.')
              ? (abrir.error.slice('messages.errors.'.length) as 'apertura_fallo')
              : ('apertura_fallo' as const)
            toast.error(tErr(key))
            return
          }
          const enviar = await enviarMensaje({
            kind: 'admin_familia',
            conversacion_id: abrir.data.conversacion_id,
            contenido: trimmed,
          })
          if (!enviar.success) {
            const key = enviar.error.startsWith('messages.errors.')
              ? (enviar.error.slice('messages.errors.'.length) as 'envio_fallo')
              : ('envio_fallo' as const)
            toast.error(tErr(key))
            return
          }
          setContenido('')
          router.refresh()
          return
        }

        const res = isAdminFamilia
          ? await enviarMensaje({
              kind: 'admin_familia',
              conversacion_id: (props as AdminFamiliaProps).conversacionId,
              contenido: trimmed,
            })
          : await enviarMensaje({
              nino_id: (props as ProfeFamiliaProps).ninoId,
              contenido: trimmed,
            })

        if (!res.success) {
          const key = res.error.startsWith('messages.errors.')
            ? (res.error.slice('messages.errors.'.length) as 'envio_fallo')
            : ('envio_fallo' as const)
          toast.error(tErr(key))
          return
        }
        setContenido('')
        if (
          !isAdminFamilia &&
          (props as ProfeFamiliaProps).redirectOnFirstSend &&
          res.data.conversacion_id
        ) {
          router.push(
            `/${(props as ProfeFamiliaProps).locale}/messages/conversacion/${res.data.conversacion_id}`
          )
        } else {
          router.refresh()
        }
      } catch {
        toast.error(tErr('envio_fallo'))
      }
    })
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    send()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-background -mx-4 shrink-0 border-t px-4 py-3 md:-mx-8 md:px-8"
      data-testid="mensaje-composer-form"
    >
      {caducada && (
        <p
          className="border-warning-300 bg-warning-100 text-warning-900 mb-2 rounded-md border-l-4 px-3 py-2 text-xs"
          data-testid="composer-cerrado"
        >
          {tAdmin('composer_cerrado')}
        </p>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Textarea
            value={contenido}
            onChange={(e) => setContenido(e.target.value.slice(0, MAX + 10))}
            onKeyDown={onKeyDown}
            placeholder={t('composer_placeholder')}
            rows={2}
            className="resize-none"
            disabled={pending || caducada}
            aria-label={t('composer_placeholder')}
            name="contenido"
          />
          <div className="text-muted-foreground mt-1 text-xs" aria-live="polite">
            {t('contador', { n: length, max: MAX })}
          </div>
        </div>
        <button
          type="submit"
          disabled={disabled}
          className={cn(buttonVariants({ variant: 'default' }), 'shrink-0')}
          data-testid="mensaje-composer-submit"
        >
          <SendHorizonalIcon className="size-4" />
          <span className="ml-1">{pending ? t('enviando') : t('enviar')}</span>
        </button>
      </div>
    </form>
  )
}
