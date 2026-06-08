'use client'

import { useEffect, useRef } from 'react'

import { marcarNotificacionesVistas } from '../actions/marcar-vistas'

/**
 * Al montar la pestaña /notifications, sella el marcador `visto_at` para que el
 * badge baje a 0 en la siguiente navegación (read-on-open, patrón lectura_anuncio).
 * Sin UI. `useRef` evita doble llamada en StrictMode/dev.
 */
export function MarcarVistasOnMount() {
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    void marcarNotificacionesVistas()
  }, [])
  return null
}
