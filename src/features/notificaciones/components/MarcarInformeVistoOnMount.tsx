'use client'

import { useEffect, useRef } from 'react'

import { marcarInformeVisto } from '../actions/marcar-informe-visto'

/**
 * Al montar el detalle de un informe publicado (vista de familia), lo marca como
 * visto para el usuario: el aviso de "informes nuevos" del panel de inicio
 * desaparece y baja el contador en la siguiente navegación (read-on-open). Sin UI.
 * `useRef` evita el doble disparo de StrictMode/dev.
 */
export function MarcarInformeVistoOnMount({ informeId }: { informeId: string }) {
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    void marcarInformeVisto(informeId)
  }, [informeId])
  return null
}
