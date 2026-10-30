import type { EstadoRetencionNino, PlazoRetencion } from '../queries/get-estado-retencion-nino'

type Valores = Record<string, string>
/** `t` de next-intl sobre el espacio `retencion_estado`. */
export type Traductor = (clave: string, valores?: Valores) => string

export interface LineaEstado {
  clave: string
  etiqueta: string
  texto: string
}

type EnBaja = Exclude<EstadoRetencionNino, { estado: 'activo' }>

/**
 * Las líneas del cuadro, en el orden en que se enseñan. Solo traduce lo que dice la BD
 * (`estado_retencion_nino`): ninguna fecha se calcula aquí. Un estado o un motivo que no conoce
 * sale con su código, nunca callado.
 */
export function lineasEstado(
  e: EnBaja,
  t: Traductor,
  fecha: (iso: string) => string
): LineaEstado[] {
  const f = (iso: string | null | undefined) => (iso ? fecha(iso) : '—')

  // El borrado de lo que se va con la purga del expediente (la ficha médica, el bloqueo de las firmas).
  const conLaPurga = (p: PlazoRetencion | undefined): string => {
    if (!p) return ''
    switch (p.estado) {
      case 'se_borrara':
        return t('se_borrara', { fecha: f(p.hasta) })
      case 'vencido':
        return t('vencido', { fecha: f(p.hasta) })
      case 'sin_fecha':
        return t(`sin_fecha.${p.motivo ?? 'desconocido'}`)
      default:
        return p.estado
    }
  }

  const medicos = (() => {
    const m = e.medicos
    switch (m.estado) {
      case 'borrados':
        return t('medicos.borrados', { fecha: f(m.desde) })
      case 'bloqueados':
        return `${t('medicos.bloqueados', { fecha: f(m.desde) })} · ${conLaPurga(m.borrado)}`
      case 'a_la_vista':
        return `${m.desde ? t('medicos.a_la_vista', { fecha: f(m.desde) }) : t('sin_fecha.sin_curso')} · ${conLaPurga(m.borrado)}`
      default:
        return m.estado
    }
  })()

  const operativa = (() => {
    const o = e.operativa
    switch (o.estado) {
      case 'borrado':
        return t('operativa.borrado', { fecha: f(o.desde) })
      case 'nada':
        return t('operativa.nada')
      case 'por_partes':
        return t('operativa.por_partes', { fecha: f(o.hasta) })
      case 'vencido':
        return t('vencido', { fecha: f(o.hasta) })
      case 'sin_fecha':
        return t(`sin_fecha.${o.motivo ?? 'desconocido'}`)
      default:
        return o.estado
    }
  })()

  const firmas = (() => {
    const p = e.firmas
    if (p.estado === 'nada') return t('firmas.nada')
    if (p.motivo === 'retenido') {
      return p.estado === 'bloqueados'
        ? `${t('firmas.bloqueados_desde', { fecha: f(p.desde) })} · ${t('sin_fecha.retenido')}`
        : `${t('firmas.a_la_vista')} · ${t('sin_fecha.retenido')}`
    }
    if (p.estado === 'bloqueados') {
      const borra = p.vencido
        ? t('vencido', { fecha: f(p.hasta) })
        : t('firmas.se_destruyen', { fecha: f(p.hasta) })
      return `${t('firmas.bloqueados_desde', { fecha: f(p.desde) })} · ${borra}`
    }
    if (p.estado === 'a_la_vista') {
      return `${t('firmas.a_la_vista')} · ${t('firmas.se_bloquean_con_la_purga')} · ${t('firmas.se_destruyen', { fecha: f(p.hasta) })}`
    }
    return p.estado
  })()

  const expediente = (() => {
    const x = e.expediente
    if (x.estado === 'borrado') return t('expediente.borrado', { fecha: f(x.desde) })
    return conLaPurga(x)
  })()

  const fiscal = (() => {
    const p = e.fiscal
    if (p.estado === 'sin_fecha') {
      const motivos = (p.motivos ?? []).map((m) => t(`fiscal.motivos.${m}`)).join('; ')
      return t('fiscal.sin_fecha', { motivos })
    }
    if (p.estado === 'a_la_vista') {
      const desde = p.desde_pago ? t('fiscal.desde_pago') : t('fiscal.desde_baja')
      return p.vencido
        ? `${t('fiscal.vencido', { fecha: f(p.hasta) })} (${desde})`
        : `${t('fiscal.a_la_vista', { fecha: f(p.hasta) })} (${desde})`
    }
    return p.estado
  })()

  const cuentas = e.cuentas.map((c): LineaEstado => {
    const etiqueta = c.nombre
      ? t('cuenta.etiqueta', { nombre: c.nombre })
      : t('cuenta.etiqueta_borrada')
    let texto: string
    switch (c.estado) {
      case 'borrada':
        texto = t('cuenta.borrada', { fecha: f(c.desde) })
        break
      case 'se_borrara':
        texto = t('se_borrara', { fecha: f(c.hasta) })
        break
      case 'vencido':
        texto = t('vencido', { fecha: f(c.hasta) })
        break
      case 'sin_fecha':
        texto = t(`cuenta.motivos.${c.motivo ?? 'desconocido'}`)
        break
      default:
        texto = c.estado
    }
    if (c.por_otro_hijo && (c.estado === 'se_borrara' || c.estado === 'vencido')) {
      texto = `${texto} · ${t('cuenta.por_otro_hijo', { fecha: f(c.baja_ultimo_hijo) })}`
    }
    return { clave: `cuenta:${c.usuario_id}`, etiqueta, texto }
  })

  return [
    { clave: 'medicos', etiqueta: t('medicos.etiqueta'), texto: medicos },
    { clave: 'operativa', etiqueta: t('operativa.etiqueta'), texto: operativa },
    { clave: 'firmas', etiqueta: t('firmas.etiqueta'), texto: firmas },
    { clave: 'fiscal', etiqueta: t('fiscal.etiqueta'), texto: fiscal },
    ...cuentas,
    { clave: 'expediente', etiqueta: t('expediente.etiqueta'), texto: expediente },
  ]
}
