'use client'

import { useEffect, useRef } from 'react'

import { marcarFirmaVista } from '../actions/marcar-firma-vista'

/**
 * Al montar el detalle de una autorización firmable, la marca como vista para el
 * usuario: el aviso de "nueva firma" del panel desaparece y baja el contador en la
 * siguiente navegación (read-on-open). Sin UI. `useRef` evita el doble disparo de
 * StrictMode/dev.
 */
export function MarcarFirmaVistaOnMount({ autorizacionId }: { autorizacionId: string }) {
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    void marcarFirmaVista(autorizacionId)
  }, [autorizacionId])
  return null
}
