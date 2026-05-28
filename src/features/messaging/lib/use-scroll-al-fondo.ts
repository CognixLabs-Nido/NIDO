'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Umbral en píxeles para considerar que el usuario está "cerca del fondo".
 * Por debajo de esto el auto-scroll se dispara con cada mensaje nuevo;
 * por encima respetamos la lectura de histórico y mostramos el botón
 * flotante "ir al último".
 */
const UMBRAL_CERCA_DEL_FONDO_PX = 100

interface UseScrollAlFondoResult {
  /** Pásalo como `ref` al contenedor scrolleable (el que tiene
   *  `overflow-y: auto`, no al `<ol>` ni a un sentinel). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** True cuando el usuario está alejado del fondo. La vista lo usa
   *  para renderizar condicionalmente `<IrAlFondoButton>`. */
  mostrarBotonIrAlFondo: boolean
  /** Scroll suave al fondo. Llámalo desde el `onClick` del botón. */
  irAlFondo: () => void
}

/**
 * Comportamiento de scroll tipo WhatsApp para hilos de conversación
 * (F5.6-C). Centraliza tres reglas que aplicaban repetidas con distintas
 * implementaciones en las tres vistas (`ConversacionView`,
 * `ConversacionAdminFamiliaView`, `ConversacionesSplitView`):
 *
 *  1. **Scroll inicial al fondo** al montar, sin animación (instantáneo).
 *  2. **Auto-scroll al recibir mensajes nuevos**, pero SOLO si el usuario
 *     ya estaba cerca del fondo (`< 100px`). Si está leyendo histórico
 *     arriba, no saltamos. Importante con realtime de F5: un mensaje
 *     entrante no debe romper la lectura.
 *  3. **Botón "ir al último"** que aparece cuando el usuario se aleja del
 *     fondo y desaparece al volver. Solo este botón hace scroll suave
 *     (`scroll-behavior: smooth`); el auto-scroll del punto 2 es
 *     instantáneo para no sacudir la UI con cada mensaje.
 *
 * Cómo detecta "estaba cerca del fondo ANTES de insertar el mensaje":
 * mantenemos `estabaCercaDelFondoRef` actualizado por el handler de
 * `scroll`. Cuando llega un mensaje nuevo, React re-renderiza y el
 * `useEffect` dependiente de `mensajesLength` se dispara DESPUÉS del
 * commit; insertar contenido en el DOM no dispara `scroll` (el scrollTop
 * no cambia), así que el ref refleja el estado previo del usuario al
 * llegar el mensaje. Funcionalmente equivalente a "evaluar antes de
 * insertar" sin necesidad de coordinarlo en el padre.
 *
 * Parámetro `mensajesLength`: cualquier número que cambie cuando llegan
 * mensajes (típicamente `mensajes.length`). El hook reacciona al cambio.
 */
export function useScrollAlFondo(mensajesLength: number): UseScrollAlFondoResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [mostrarBotonIrAlFondo, setMostrarBotonIrAlFondo] = useState(false)
  const estabaCercaDelFondoRef = useRef(true)

  // Suscripción al scroll del contenedor: actualiza el ref de "cerca del
  // fondo" y la visibilidad del botón. Solo se monta una vez.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onScroll = () => {
      const distancia = el.scrollHeight - el.scrollTop - el.clientHeight
      const cerca = distancia < UMBRAL_CERCA_DEL_FONDO_PX
      estabaCercaDelFondoRef.current = cerca
      setMostrarBotonIrAlFondo(!cerca)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Scroll inicial al fondo: instantáneo, una sola vez al montar.
  // No depende de mensajesLength para no interferir con el efecto de
  // abajo si los mensajes llegasen tras el primer render.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    estabaCercaDelFondoRef.current = true
    setMostrarBotonIrAlFondo(false)
  }, [])

  // Reacción a mensajes nuevos: scroll instantáneo al fondo SOLO si el
  // usuario estaba cerca. Si está leyendo histórico, queda donde está
  // y el botón flotante aparece (ya gestionado por el handler de scroll
  // arriba al haberse alejado del fondo previamente).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (estabaCercaDelFondoRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [mensajesLength])

  const irAlFondo = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      // Fallback (entornos sin scrollTo): asignación directa, sin animación.
      el.scrollTop = el.scrollHeight
    }
  }, [])

  return { containerRef, mostrarBotonIrAlFondo, irAlFondo }
}
