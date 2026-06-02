/** Ventana [lunes, domingo] de la semana ISO en curso + hoy, en huso Europe/Madrid. */
export interface VentanaSemana {
  /** Hoy YYYY-MM-DD (Madrid). */
  hoy: string
  /** Lunes YYYY-MM-DD. */
  desde: string
  /** Domingo YYYY-MM-DD. */
  hasta: string
}

const TZ = 'Europe/Madrid'

/** Fecha civil YYYY-MM-DD de un instante en huso Madrid (en-CA da ese formato). */
export function fechaMadrid(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Semana ISO (lun–dom) que contiene a `now` en huso Madrid. La aritmética de
 * días se hace en UTC sobre la fecha civil de Madrid: solo importan año/mes/día,
 * así que no arrastra saltos de DST. Inyectar `now` la hace testeable.
 */
export function ventanaSemana(now: Date): VentanaSemana {
  const hoy = fechaMadrid(now)
  const [y, m, d] = hoy.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const dow = base.getUTCDay() // 0=domingo … 6=sábado
  const desdeLunes = dow === 0 ? 6 : dow - 1 // días transcurridos desde el lunes
  const lunes = new Date(base)
  lunes.setUTCDate(base.getUTCDate() - desdeLunes)
  const domingo = new Date(lunes)
  domingo.setUTCDate(lunes.getUTCDate() + 6)
  return { hoy, desde: ymdUTC(lunes), hasta: ymdUTC(domingo) }
}
