'use client'

import { useEffect, useRef } from 'react'

import { marcarRecibosVistos } from '../actions/marcar-recibos-vistos'

/**
 * Al montar la lista de recibos de la familia, marca como vistos todos los recibos
 * visibles: el aviso de "recibos nuevos" del panel de inicio desaparece y baja el
 * contador en la siguiente navegación (read-on-open). Sin UI. `useRef` evita el doble
 * disparo de StrictMode/dev. Serializa los ids en `clave` para que el efecto solo
 * dependa de un primitivo (sin re-disparo por identidad del array).
 */
export function MarcarRecibosVistosOnMount({ reciboIds }: { reciboIds: string[] }) {
  const hecho = useRef(false)
  const clave = reciboIds.join(',')
  useEffect(() => {
    if (hecho.current || clave === '') return
    hecho.current = true
    void marcarRecibosVistos(clave.split(','))
  }, [clave])
  return null
}
