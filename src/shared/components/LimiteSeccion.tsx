'use client'

import { Component, type ReactNode } from 'react'

import { NoSePudoLeer } from './NoSePudoLeer'

interface Props {
  children: ReactNode
}

/**
 * Aísla una SECCIÓN (censo C, 2026-11-25): si algo dentro falla al leer (una `LecturaFallida`, también la
 * que lanza un componente de servidor de dentro), esta parte dice «no se ha podido leer» y el resto de la
 * pantalla sigue funcionando. Sin ella, el fallo sube al `error.tsx` y se lleva la página entera.
 */
export class LimiteSeccion extends Component<Props, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError(): { fallo: boolean } {
    return { fallo: true }
  }

  render() {
    if (this.state.fallo) {
      return <NoSePudoLeer alcance="seccion" reintentar={() => this.setState({ fallo: false })} />
    }
    return this.props.children
  }
}
