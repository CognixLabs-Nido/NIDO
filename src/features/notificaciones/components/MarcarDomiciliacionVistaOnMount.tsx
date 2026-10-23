'use client'

import { useEffect, useRef } from 'react'

import { marcarDomiciliacionVista } from '../actions/marcar-domiciliacion-vista'

/**
 * Al montar la ficha de una familia, marca su domiciliación como vista para Dirección: el
 * aviso de "domiciliación nueva" del inicio desaparece en la siguiente navegación
 * (read-on-open). Sin UI. `useRef` evita el doble disparo de StrictMode/dev.
 */
export function MarcarDomiciliacionVistaOnMount({ familiaId }: { familiaId: string }) {
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    void marcarDomiciliacionVista(familiaId)
  }, [familiaId])
  return null
}
