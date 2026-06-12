'use client'

import { useEffect, useRef } from 'react'

import { marcarFotosVistas } from '../actions/marcar-fotos-vistas'

/**
 * Al montar la vista del blog del aula (familia), marca como vistas todas las
 * publicaciones visibles: el aviso de "publicaciones nuevas" del panel de inicio
 * baja en la siguiente navegación (read-on-open, P8). Sin UI. `useRef` evita el
 * doble disparo de StrictMode/dev. La clave de dependencia es el join de ids para
 * re-disparar si cambia el conjunto (p. ej. al paginar en el futuro).
 */
export function MarcarFotosVistasOnMount({ ids }: { ids: string[] }) {
  const hecho = useRef('')
  const clave = ids.join(',')
  useEffect(() => {
    if (ids.length === 0 || hecho.current === clave) return
    hecho.current = clave
    void marcarFotosVistas(ids)
  }, [clave, ids])
  return null
}
